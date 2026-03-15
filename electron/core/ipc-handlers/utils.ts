import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

import type { AgentId, AgentMessage, FileAttachment, SpawnOptions } from '../agents/types';
import { extendedEnv, resolveSshCommand } from '../process-utils';
import type { SessionStore } from '../session/store';
import type { Workspace } from '../worktree/types';

const execFileAsync = promisify(execFile);

export const MAX_ATTACHED_FILES = 6;
export const MAX_ATTACHMENT_CHARS_PER_FILE = 12_000;
export const MAX_TOTAL_ATTACHMENT_CHARS = 40_000;
export const MAX_AUTO_RETRIES = 2;
export const RECOVERY_DELAY_MS = 200;
export const AGENTS_WITH_NATIVE_RESUME = new Set<AgentId>(['claude-code', 'codex']);

export function requireFields(obj: Record<string, unknown>, ...fields: string[]): void {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      throw new Error(`Missing required field: ${f}`);
    }
  }
}

export function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toRemoteShellPath(value: string): string {
  const trimmed = value.trim() || '~';
  if (trimmed === '~') return '"$HOME"';
  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2);
    return rest ? `"${'$'}HOME"/${escapeShellArg(rest)}` : '"$HOME"';
  }
  return escapeShellArg(trimmed);
}

export function expandLocalHomePath(value: string): string {
  const trimmed = value.trim() || '~';
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/')) return path.join(homeDir, trimmed.slice(2));
  return trimmed;
}

export function buildSessionTitle(prompt: string): string {
  const nonEmptyLines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (nonEmptyLines[nonEmptyLines.length - 1] ?? 'Untitled').slice(0, 80);
}

export function getAgentLabel(agentId: AgentId): string {
  switch (agentId) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'openai':
      return 'OpenAI';
    case 'ollama':
      return 'Ollama';
    default:
      return agentId;
  }
}

export function serializePayload(payload: unknown): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(probe, [command], { timeout: 5000, env: extendedEnv() });
    return true;
  } catch {
    return false;
  }
}

export function toStoredMessage(message: AgentMessage) {
  return {
    role: message.role,
    type: message.type,
    content: message.content,
    toolName: message.toolName ?? null,
    toolInput: message.toolInput ? JSON.stringify(message.toolInput) : null,
    toolCallId: message.toolCallId ?? null,
    costUsd: message.costUsd ?? null,
    inputTokens: message.inputTokens ?? null,
    outputTokens: message.outputTokens ?? null,
    payloadJson: serializePayload(message),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readAgentSessionId(metadata: Record<string, unknown> | undefined, agentId: AgentId): string | undefined {
  if (!metadata) return undefined;
  const agentSessions = metadata.agentSessions;
  if (!isRecord(agentSessions)) return undefined;
  const session = agentSessions[agentId];
  if (!isRecord(session)) return undefined;
  return typeof session.sessionId === 'string' ? session.sessionId : undefined;
}

export async function runShellCommand(command: string, cwd: string, remoteHost: string | null): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  if (remoteHost) {
    try {
      const { stdout, stderr } = await execFileAsync(
        resolveSshCommand(),
        [remoteHost, `cd ${toRemoteShellPath(cwd)} && ${command}`],
        { timeout: 120000, env: extendedEnv() },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
        exitCode: err.code ?? 1,
      };
    }
  }

  const shell = process.platform === 'win32'
    ? 'powershell.exe'
    : process.env.SHELL && fs.existsSync(process.env.SHELL)
      ? process.env.SHELL
      : '/bin/sh';
  const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-lc', command];

  try {
    const { stdout, stderr } = await execFileAsync(shell, args, {
      cwd,
      timeout: 120000,
      env: extendedEnv(),
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode: err.code ?? 1,
    };
  }
}

export function buildUserMessagePayload(
  prompt: string,
  images?: string[],
  attachments?: FileAttachment[],
): AgentMessage {
  return {
    type: 'text',
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
    ...(images?.length ? { images } : {}),
    ...(attachments?.length ? { attachments } : {}),
  };
}

export function buildStoredUserMessage(
  prompt: string,
  images?: string[],
  attachments?: FileAttachment[],
) {
  const payload = buildUserMessagePayload(prompt, images, attachments);
  return {
    role: 'user',
    type: 'text',
    content: prompt,
    toolName: null,
    toolInput: null,
    toolCallId: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    payloadJson: serializePayload(payload),
  };
}

export function safeParse(input: string | null | undefined): Record<string, unknown> | null {
  if (!input) return null;
  try { return JSON.parse(input); } catch { return null; }
}

export function buildConversationContext(sessionId: string, sessionStore: SessionStore, maxChars = 16_000): string {
  const messages = sessionStore.getMessages(sessionId);
  if (!messages.length) return '';

  const filePaths = new Set<string>();
  const toolActions: string[] = [];
  for (const m of messages) {
    if (m.toolName && m.toolInput) {
      const input = safeParse(typeof m.toolInput === 'string' ? m.toolInput : JSON.stringify(m.toolInput));
      for (const key of ['file_path', 'path', 'filePath']) {
        if (typeof input?.[key] === 'string') filePaths.add(input[key] as string);
      }
      if (m.toolName === 'shell' || m.toolName === 'bash') {
        const cmd = input?.command ?? input?.cmd;
        if (typeof cmd === 'string') toolActions.push(cmd);
      }
    }
  }

  const lastAssistant = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 100);

  const userTurns = messages
    .filter(m => m.role === 'user' && m.type === 'text' && m.content)
    .slice(-5)
    .map(m => m.content);

  const sections: string[] = [];

  if (lastAssistant) {
    const truncated = lastAssistant.content.length > 6000
      ? lastAssistant.content.slice(0, 6000) + '\n[truncated]'
      : lastAssistant.content;
    sections.push(`## Last assistant response\n${truncated}`);
  }

  if (userTurns.length > 1) {
    sections.push(`## Recent user messages\n${userTurns.slice(0, -1).map(t => `- ${t.slice(0, 200)}`).join('\n')}`);
  }

  if (filePaths.size > 0) {
    sections.push(`## Files discussed\n${[...filePaths].slice(0, 30).map(f => `- ${f}`).join('\n')}`);
  }

  if (toolActions.length > 0) {
    sections.push(`## Commands run\n${toolActions.slice(-10).map(c => `- \`${c.slice(0, 120)}\``).join('\n')}`);
  }

  let result = sections.join('\n\n');
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '\n[truncated]';
  }
  return result;
}

export interface DiffHunk { header: string; lines: string[] }
export interface DiffFileEntry { path: string; additions: number; deletions: number; hunks: DiffHunk[] }
export interface DiffData { files: DiffFileEntry[]; totalAdditions: number; totalDeletions: number }

export async function captureGitSnapshot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function captureGitDiff(cwd: string, baseRef: string): Promise<DiffData | null> {
  try {
    const args = baseRef ? ['diff', baseRef, '--unified=3'] : ['diff', '--unified=3'];
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 });
    if (!stdout.trim()) return null;
    return parseUnifiedDiff(stdout);
  } catch {
    return null;
  }
}

export interface WorkspacePendingChanges {
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  hasPendingChanges: boolean;
}

/**
 * Detect pending changes in a workspace by checking both commits ahead of the
 * parent branch and uncommitted working-tree changes.  Uses `git merge-base`
 * to find the true divergence point so the result is reliable even when the
 * parent repo HEAD is on a different branch.
 */
export async function workspaceHasPendingChanges(workspace: Workspace): Promise<WorkspacePendingChanges> {
  let hasCommits = false;
  let hasUncommittedChanges = false;

  // 1. Check for commits ahead of the merge-base with the parent branch
  try {
    const { stdout: parentBranch } = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: workspace.parentRepo, timeout: 5000 },
    );
    const target = parentBranch.trim() || 'HEAD';

    // Use merge-base for an accurate divergence point
    const { stdout: mergeBaseOut } = await execFileAsync(
      'git', ['merge-base', target, 'HEAD'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );
    const mergeBase = mergeBaseOut.trim();

    if (mergeBase) {
      const { stdout: countOut } = await execFileAsync(
        'git', ['rev-list', '--count', `${mergeBase}..HEAD`],
        { cwd: workspace.worktreePath, timeout: 5000 },
      );
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    }
  } catch {
    // Fallback: try the simpler rev-list check
    try {
      const { stdout: countOut } = await execFileAsync(
        'git', ['rev-list', '--count', 'HEAD'],
        { cwd: workspace.worktreePath, timeout: 5000 },
      );
      // If the branch has any commits at all, treat it as having commits
      // (conservative fallback when merge-base fails)
      hasCommits = parseInt(countOut.trim(), 10) > 0;
    } catch {
      // Cannot determine commit state
    }
  }

  // 2. Check for uncommitted changes (staged, unstaged, untracked)
  try {
    const { stdout: statusOut } = await execFileAsync(
      'git', ['status', '--porcelain'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );
    hasUncommittedChanges = statusOut.trim().length > 0;
  } catch {
    // Cannot determine uncommitted state
  }

  return {
    hasCommits,
    hasUncommittedChanges,
    hasPendingChanges: hasCommits || hasUncommittedChanges,
  };
}

/** @deprecated Use workspaceHasPendingChanges instead */
export async function workspaceHasCommits(workspace: Workspace): Promise<boolean> {
  const result = await workspaceHasPendingChanges(workspace);
  return result.hasPendingChanges;
}

/**
 * Check whether a workspace branch has been fully merged into the parent
 * branch.  Uses `git merge-base --is-ancestor` which returns exit code 0
 * when every commit on the workspace branch is reachable from the parent.
 */
export async function isWorkspaceBranchMerged(workspace: Workspace): Promise<boolean> {
  try {
    const { stdout: parentBranch } = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: workspace.parentRepo, timeout: 5000 },
    );
    const target = parentBranch.trim() || 'HEAD';

    // Get the workspace branch tip from the worktree
    const { stdout: branchTip } = await execFileAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );

    // Check if the workspace branch tip is an ancestor of the parent branch
    await execFileAsync(
      'git', ['merge-base', '--is-ancestor', branchTip.trim(), target],
      { cwd: workspace.parentRepo, timeout: 5000 },
    );
    // Exit code 0 → the branch is fully merged
    return true;
  } catch {
    // Exit code 1 → not merged, or any other error
    return false;
  }
}

export function parseUnifiedDiff(raw: string): DiffData {
  const files: DiffFileEntry[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const headerMatch = section.match(/a\/(.+?)\s+b\/(.+)/);
    const filePath = headerMatch?.[2] ?? 'unknown';
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;

    const hunkParts = section.split(/^(@@.+@@.*$)/m);
    for (let i = 1; i < hunkParts.length; i += 2) {
      const hunkHeader = hunkParts[i];
      const hunkBody = hunkParts[i + 1] ?? '';
      const lines = hunkBody.split('\n').filter((l) => l !== '');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
      hunks.push({ header: hunkHeader, lines });
    }

    files.push({ path: filePath, additions, deletions, hunks });
  }

  return {
    files,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
  };
}

export function toAbsoluteFilePath(root: string, file: string): string {
  if (path.isAbsolute(file)) return file;
  if (root === '/') return `/${file}`;
  return `${root.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}

export async function buildPromptWithAttachments(
  prompt: string,
  attachments: FileAttachment[] | undefined,
  sshHost: string | null,
): Promise<string> {
  if (!attachments?.length) return prompt;

  const blocks: string[] = [];
  let remainingChars = MAX_TOTAL_ATTACHMENT_CHARS;

  for (const attachment of attachments.slice(0, MAX_ATTACHED_FILES)) {
    if (remainingChars <= 0) break;

    try {
      const preview = await readAttachmentPreview(
        attachment.path,
        Math.min(MAX_ATTACHMENT_CHARS_PER_FILE, remainingChars),
        sshHost,
      );
      remainingChars -= preview.text.length;

      if (preview.binary) {
        blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n[Binary file omitted]`);
        continue;
      }

      const suffix = preview.truncated ? '\n[Truncated attachment preview]' : '';
      blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n${preview.text}${suffix}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n[Unable to read attachment: ${message}]`);
    }
  }

  if (attachments.length > MAX_ATTACHED_FILES) {
    blocks.push(`[${attachments.length - MAX_ATTACHED_FILES} additional attachments omitted]`);
  }

  if (blocks.length === 0) return prompt;

  return `Attached file context:\n\n${blocks.join('\n\n')}\n\nUser request:\n${prompt}`;
}

async function readAttachmentPreview(
  filePath: string,
  maxChars: number,
  sshHost: string | null,
): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  if (sshHost) {
    const cmd = `head -c ${maxChars + 1} ${toRemoteShellPath(filePath)}`;
    const { stdout } = await execFileAsync(resolveSshCommand(), [sshHost, cmd], {
      timeout: 10000,
      env: extendedEnv(),
    });
    const text = stdout;
    return {
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      binary: text.includes('\u0000'),
    };
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxChars + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, maxChars + 1, 0);
    const slice = buffer.subarray(0, bytesRead);
    const truncated = bytesRead > maxChars;
    return {
      text: slice.subarray(0, Math.min(bytesRead, maxChars)).toString('utf-8'),
      truncated,
      binary: slice.includes(0),
    };
  } finally {
    fs.closeSync(fd);
  }
}

const AUTO_BRANCH_PATTERNS = [
  /^flux\/[a-z]+-[a-z]+$/,                     // fun names like flux/zagreb-lima
  /^flux\/workspace-[a-z0-9-]+$/,              // flux/workspace-20260315-abc123
  /^[a-z]+-[a-z]+(-v\d+)?$/,                   // bare fun names like zagreb-v2
  /^workspace-\d{8}-[a-z0-9]+$/,               // workspace-20260315-abc123
];

export function isAutoGeneratedBranch(branch: string): boolean {
  return AUTO_BRANCH_PATTERNS.some((pattern) => pattern.test(branch));
}

export function buildWorkspaceSystemContext(
  workspace: Workspace,
  mode: SpawnOptions['mode'],
  workspaceAction?: 'merge',
  agentId?: AgentId,
): string | null {
  if (workspaceAction === 'merge') return null;

  const lines = [
    `## Workspace Context`,
    `You are working in a dedicated workspace branch.`,
    `- Branch: \`${workspace.branch}\``,
    `- Working directory: \`${workspace.worktreePath}\``,
    `- Parent repository: \`${workspace.parentRepo}\``,
  ];

  if (mode === 'act') {
    if (isAutoGeneratedBranch(workspace.branch)) {
      lines.push(
        '',
        '## Branch naming',
        'The current branch name is auto-generated. Before starting work, rename it to',
        'something short and descriptive that reflects the task. Use `git branch -m <new-name>`.',
        'Keep the name under 50 characters, lowercase with hyphens (e.g. `fix-login-redirect`).',
      );
    }

    lines.push(
      '',
      '## Instructions',
      '- Make the requested changes directly in the workspace.',
      '- Commit your changes with clear, descriptive commit messages when you are done.',
      '- Do NOT push to remote or create pull requests — the user will merge via the UI.',
      '- After committing, summarize what you changed.',
    );

    if (agentId === 'claude-code') {
      lines.push(
        '',
        '## Progress tracking',
        'For multi-step tasks, use the `TodoWrite` tool to track your progress:',
        '- Create a todo list at the start with all steps.',
        '- Mark each step `in_progress` when you begin, `completed` when done.',
        '- This keeps the user informed of your progress in real time.',
      );
    } else if (agentId === 'codex') {
      lines.push(
        '',
        '## Progress tracking',
        'For multi-step tasks, track your progress by outputting markers:',
        '- `[STEP <number> START]` when you begin a step.',
        '- `[STEP <number> DONE]` when you complete a step.',
      );
    }
  } else if (mode === 'plan') {
    lines.push(
      '',
      '## Instructions',
      '- Analyze the codebase and create a detailed plan.',
      '- Do NOT modify files or run destructive commands.',
    );
  }

  return lines.join('\n');
}

export function extractFullPlanText(sessionStore: SessionStore, sessionId: string): string {
  const messages = sessionStore.getMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 80) {
      return m.content;
    }
  }
  return '';
}

export async function writePlanFile(cwd: string, planText: string): Promise<string | null> {
  if (!planText) return null;
  try {
    const contextDir = path.join(cwd, '.context');
    await fs.promises.mkdir(contextDir, { recursive: true });
    const planPath = path.join(contextDir, 'plan.md');
    await fs.promises.writeFile(planPath, planText, 'utf-8');
    return planPath;
  } catch {
    return null;
  }
}

export function extractPlanTodoItems(sessionStore: SessionStore, sessionId: string): { label: string }[] {
  const messages = sessionStore.getMessages(sessionId);
  const planMsg = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 80);
  if (!planMsg) return [];

  const stepsMatch = planMsg.content.match(/^#{2,3}\s+Steps?\b[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|\s*$)/im);
  const source = stepsMatch ? stepsMatch[1] : planMsg.content;
  const items: { label: string }[] = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) items.push({ label: match[1].trim() });
  }
  return items;
}

export function buildStepTrackingPrompt(steps: { label: string }[], agentId?: AgentId): string {
  if (steps.length === 0) return '';
  const list = steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n');

  if (agentId === 'claude-code') {
    return [
      '',
      '## Progress tracking',
      'Use the `TodoWrite` tool to track your progress through these steps.',
      'Call `TodoWrite` at the start to create the todo list, then update each',
      'item to `in_progress` when you start it and `completed` when you finish.',
      '',
      list,
      '',
    ].join('\n');
  }

  return [
    '',
    '## Progress tracking',
    'Here are the plan steps. As you complete each step, output a line:',
    '[STEP <number> DONE]',
    'When you start working on a step, output:',
    '[STEP <number> START]',
    '',
    list,
    '',
  ].join('\n');
}

export interface StepMarker {
  stepId: number;
  status: 'in_progress' | 'done';
}

/**
 * Scan a string for `[STEP N START]` and `[STEP N DONE]` markers.
 * Returns deduplicated markers — if a step appears as both START and DONE
 * in the same content block, the DONE wins.
 */
export function parseStepMarkers(content: string): StepMarker[] {
  const markers = new Map<number, StepMarker>();

  for (const m of content.matchAll(/\[STEP\s+(\d+)\s+START\]/gi)) {
    const stepId = parseInt(m[1], 10);
    if (!markers.has(stepId)) {
      markers.set(stepId, { stepId, status: 'in_progress' });
    }
  }

  for (const m of content.matchAll(/\[STEP\s+(\d+)\s+DONE\]/gi)) {
    const stepId = parseInt(m[1], 10);
    // DONE always wins over START
    markers.set(stepId, { stepId, status: 'done' });
  }

  return Array.from(markers.values());
}

/**
 * Extract trackable text content from any non-user AgentMessage.
 * Returns the content string if it should be scanned for step markers,
 * or null if the message should be skipped.
 */
export function getStepTrackableContent(message: AgentMessage): string | null {
  if (message.role === 'user') return null;
  if (!message.content || typeof message.content !== 'string') return null;

  switch (message.type) {
    case 'text':
    case 'status':
    case 'tool_result':
      return message.content;
    default:
      return null;
  }
}

export interface RateLimitInfo {
  providerId: 'claude-code' | 'codex';
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt: number;
  rateLimitType: string;
  utilization: number;
  overageStatus?: string;
  overageResetsAt?: number;
  fetchedAt?: number;
}

export function normalizeRateLimitInfo(
  raw: Record<string, any> | undefined | null,
  providerId: 'claude-code' | 'codex',
): RateLimitInfo | null {
  if (!raw) return null;

  const utilization = typeof raw.utilization === 'number'
    ? raw.utilization
    : typeof raw.used_percent === 'number'
      ? raw.used_percent / 100
      : typeof raw.percentCapacity === 'number'
        ? raw.percentCapacity / 100
        : typeof raw.percent_capacity === 'number'
          ? raw.percent_capacity / 100
          : 0;

  return {
    providerId,
    status: raw.status ?? (utilization >= 1 ? 'rejected' : utilization >= 0.8 ? 'allowed_warning' : 'allowed'),
    resetsAt: raw.resetsAt ?? raw.resets_at ?? raw.resetAt ?? 0,
    rateLimitType: raw.rateLimitType ?? raw.rate_limit_type ?? raw.type ?? 'unknown',
    utilization,
    ...(raw.fetchedAt ? { fetchedAt: raw.fetchedAt } : {}),
    ...(raw.overageStatus ? { overageStatus: raw.overageStatus } : {}),
    ...(raw.overageResetsAt ? { overageResetsAt: raw.overageResetsAt } : {}),
    ...(raw.overage_status ? { overageStatus: raw.overage_status } : {}),
    ...(raw.overage_resets_at ? { overageResetsAt: raw.overage_resets_at } : {}),
  };
}
