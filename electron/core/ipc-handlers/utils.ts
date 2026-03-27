import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

import type { AgentId, AgentMessage, FileAttachment, SpawnOptions } from '../agents/types';
import type { Session } from '../session/types';
import { composeSkillPrompts } from '../agents/skills';
import { logDiagnostic } from '../diagnostics/logger';
import { extendedEnv } from '../process-utils';
import type { SessionStore } from '../session/store';
import { createWorkspaceFs } from '../worktree/workspace-fs';
import type { Workspace, WorkspaceOutcome } from '../worktree/types';

const execFileAsync = promisify(execFile);

export const MAX_ATTACHED_FILES = 6;
export const MAX_ATTACHMENT_CHARS_PER_FILE = 12_000;
export const MAX_TOTAL_ATTACHMENT_CHARS = 40_000;
export const MAX_AUTO_RETRIES = 2;
export const RECOVERY_DELAY_MS = 200;
export const AGENTS_WITH_NATIVE_RESUME = new Set<AgentId>(['claude-code', 'codex', 'copilot']);

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
    case 'copilot':
      return 'GitHub Copilot';
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

export type NormalizedTodoItem = {
  id: number;
  label: string;
  status: 'pending' | 'in_progress' | 'done';
};

function normalizeTodoStatus(value: unknown): NormalizedTodoItem['status'] {
  if (typeof value === 'boolean') {
    return value ? 'done' : 'pending';
  }

  if (typeof value !== 'string') return 'pending';
  const normalized = value.toLowerCase().trim();
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done' || normalized === 'finished') {
    return 'done';
  }
  if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'active' || normalized === 'doing') {
    return 'in_progress';
  }
  return 'pending';
}

function normalizeTodoLabel(value: Record<string, unknown>): string {
  for (const key of ['content', 'title', 'label', 'text', 'task', 'step']) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return '';
}

function extractTodoArrayFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  for (const key of ['todos', 'items', 'tasks', 'steps', 'plan']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }

  if (isRecord(payload.data)) {
    return extractTodoArrayFromPayload(payload.data);
  }

  return [];
}

export function extractTodoItemsFromPayload(payload: unknown): NormalizedTodoItem[] {
  const rawItems = extractTodoArrayFromPayload(payload);
  return rawItems
    .map((item, i): NormalizedTodoItem | null => {
      if (typeof item === 'string') {
        const label = item.trim();
        if (!label) return null;
        return { id: i + 1, label, status: 'pending' };
      }
      if (!isRecord(item)) return null;

      const label = normalizeTodoLabel(item);
      if (!label) return null;

      const status = normalizeTodoStatus(
        item.status ?? item.state ?? item.done ?? item.completed,
      );

      return { id: i + 1, label, status };
    })
    .filter((item): item is NormalizedTodoItem => !!item);
}

export function isTodoTrackingToolCall(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): boolean {
  const normalizedToolName = toolName?.toLowerCase() ?? '';
  // Match only by tool name — payload-shape sniffing caused false positives
  // (any tool with `items`, `steps`, or `tasks` keys was misidentified).
  if (normalizedToolName.includes('todo') || normalizedToolName === 'update_plan') {
    return true;
  }

  // Tier 2: only match if the payload explicitly contains a `todos` key,
  // which is unambiguous. Generic keys like `items`/`steps`/`tasks` are too
  // common in unrelated tool calls (e.g. Glob results, batch operations).
  if (!toolInput) {
    return false;
  }

  if (Array.isArray(toolInput.todos)) {
    return extractTodoItemsFromPayload(toolInput).length > 0;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Todo block & checklist parsers for Codex / Copilot
// ---------------------------------------------------------------------------

const TODO_BLOCK_RE = /```(?:progress|todo)\s*\n([\s\S]*?)```/g;

const CHECKLIST_LINE_RE = /^[-*]\s*\[(x|X|>|~|!| )\]\s+(.+)/;

function checkboxToStatus(marker: string): NormalizedTodoItem['status'] {
  if (marker === 'x' || marker === 'X') return 'done';
  if (marker === '>' || marker === '~' || marker === '!') return 'in_progress';
  return 'pending';
}

/**
 * Parse fenced `\`\`\`todo` (or legacy `\`\`\`progress`) blocks into todo items.
 * Returns items from the LAST complete block found (most recent state).
 */
export function parseTodoBlock(content: string): NormalizedTodoItem[] {
  let lastItems: NormalizedTodoItem[] = [];

  for (const blockMatch of content.matchAll(TODO_BLOCK_RE)) {
    const blockContent = blockMatch[1];
    const items: NormalizedTodoItem[] = [];
    for (const line of blockContent.split('\n')) {
      const lineMatch = line.trim().match(CHECKLIST_LINE_RE);
      if (lineMatch) {
        items.push({
          id: items.length + 1,
          label: lineMatch[2].trim(),
          status: checkboxToStatus(lineMatch[1]),
        });
      }
    }
    if (items.length > 0) {
      lastItems = items;
    }
  }

  return lastItems;
}

/**
 * Parse markdown checklist lines into NormalizedTodoItem[].
 * Supports: `- [x]` (done), `- [~]`/`- [>]` (in_progress), `- [ ]` (pending).
 */
export function parseMarkdownChecklist(content: string): NormalizedTodoItem[] {
  const items: NormalizedTodoItem[] = [];
  for (const line of content.split('\n')) {
    const m = line.trim().match(CHECKLIST_LINE_RE);
    if (!m) continue;
    const label = m[2].trim();
    if (!label) continue;
    items.push({ id: items.length + 1, label, status: checkboxToStatus(m[1]) });
  }
  return items;
}

/**
 * Try all non-TodoWrite parsers against accumulated text, in priority order:
 * 1. FLUX_TODO: JSON lines (structured, distinctive prefix)
 * 2. Fenced ```todo blocks (explicitly requested format)
 * 3. Markdown checklists with 2+ consecutive items (common LLM output)
 * 4. [STEP N START/DONE] markers (legacy fallback)
 *
 * Returns items from the first parser that produces results.
 */
export function parseAgentTodos(content: string): {
  items: NormalizedTodoItem[];
  markers: StepMarker[];
  source: 'flux_todo' | 'todo_block' | 'checklist' | 'step_markers' | 'none';
} {
  // 1. Try FLUX_TODO / FLUX_PROGRESS: JSON lines (last occurrence wins — full state each time)
  const fluxItems = parseFluxTodoAll(content);
  if (fluxItems.length > 0) {
    return { items: fluxItems, markers: [], source: 'flux_todo' };
  }

  // 2. Try fenced todo/progress blocks
  const todoItems = parseTodoBlock(content);
  if (todoItems.length > 0) {
    return { items: todoItems, markers: [], source: 'todo_block' };
  }

  // 3. Try markdown checklists (require 2+ consecutive items to avoid false positives)
  const checklistItems = parseStandaloneChecklist(content);
  if (checklistItems.length > 0) {
    return { items: checklistItems, markers: [], source: 'checklist' };
  }

  // 4. Fall back to step markers
  const markers = parseStepMarkers(content);
  if (markers.length > 0) {
    return { items: [], markers, source: 'step_markers' };
  }

  return { items: [], markers: [], source: 'none' };
}

/**
 * Parse standalone markdown checklists from free-form text.
 * Requires 2+ consecutive checklist items to avoid false positives
 * from random single checkboxes in agent output.
 */
function parseStandaloneChecklist(content: string): NormalizedTodoItem[] {
  const checklistLine = /^[\s]*[-*]\s*\[([ xX~>!])\]\s+(.+)/;
  const lines = content.split('\n');
  let bestRun: NormalizedTodoItem[] = [];
  let currentRun: NormalizedTodoItem[] = [];

  for (const line of lines) {
    const match = line.match(checklistLine);
    if (match) {
      const marker = match[1];
      const label = match[2].trim();
      if (label) {
        let status: NormalizedTodoItem['status'] = 'pending';
        if (marker === 'x' || marker === 'X') status = 'done';
        else if (marker === '~' || marker === '>' || marker === '!') status = 'in_progress';
        currentRun.push({ id: currentRun.length + 1, label, status });
      }
    } else {
      if (currentRun.length > bestRun.length) {
        bestRun = currentRun;
      }
      currentRun = [];
    }
  }
  if (currentRun.length > bestRun.length) {
    bestRun = currentRun;
  }
  return bestRun.length >= 2 ? bestRun : [];
}

/**
 * Attempt to parse a `FLUX_TODO:{...}` (or legacy `FLUX_PROGRESS:{...}`) JSON line from a string.
 * Returns the extracted todo items or null if no valid line is found.
 */
export function parseFluxTodo(content: string): NormalizedTodoItem[] | null {
  const match = content.match(/FLUX_(?:PROGRESS|TODO):\s*(\{[\s\S]*\})/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    const items = extractTodoItemsFromPayload(data);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

/**
 * Scan a buffer of accumulated text for complete `FLUX_TODO:` (or legacy `FLUX_PROGRESS:`) lines.
 * Returns the last successfully parsed todo list (each emission is the full state)
 * and the remaining un-consumed text.
 */
export function parseFluxTodoFromBuffer(buffer: string): {
  todos: NormalizedTodoItem[] | null;
  remaining: string;
} {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';
  let lastTodos: NormalizedTodoItem[] | null = null;

  for (const line of lines) {
    const parsed = parseFluxTodo(line);
    if (parsed) lastTodos = parsed;
  }

  return { todos: lastTodos, remaining };
}

/**
 * Scan the full content for ALL `FLUX_TODO:` (or legacy `FLUX_PROGRESS:`) occurrences
 * and return the items from the last valid one (most recent full state).
 * Used by `parseAgentTodos` which receives the accumulated buffer.
 */
export interface FluxPlanData {
  summary: string;
  sections: Array<{ title: string; content: string }>;
  steps: Array<{ title: string; details: string }>;
}

/**
 * Parse a `FLUX_PLAN:{...}` JSON line from a string.
 * Returns the structured plan data or null if not found / invalid.
 */
export function parseFluxPlan(content: string): FluxPlanData | null {
  const match = content.match(/FLUX_PLAN:\s*(\{[\s\S]*\})/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    if (!data || typeof data.summary !== 'string') return null;
    return {
      summary: data.summary ?? '',
      sections: Array.isArray(data.sections) ? data.sections : [],
      steps: Array.isArray(data.steps) ? data.steps : [],
    };
  } catch {
    return null;
  }
}

/**
 * Scan full content for the last valid `FLUX_PLAN:` line.
 */
export function parseFluxPlanFromContent(content: string): FluxPlanData | null {
  let lastPlan: FluxPlanData | null = null;
  for (const line of content.split('\n')) {
    if (!line.includes('FLUX_PLAN:')) continue;
    const parsed = parseFluxPlan(line);
    if (parsed) lastPlan = parsed;
  }
  return lastPlan;
}

export function parseFluxTodoAll(content: string): NormalizedTodoItem[] {
  let lastItems: NormalizedTodoItem[] = [];
  for (const line of content.split('\n')) {
    if (!line.includes('FLUX_TODO:') && !line.includes('FLUX_PROGRESS:')) continue;
    const parsed = parseFluxTodo(line);
    if (parsed) lastItems = parsed;
  }
  return lastItems;
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
    return createWorkspaceFs(remoteHost).exec(cwd, command, { timeout: 120000 });
  }

  // Local: use login shell for proper environment setup
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
    let target = workspace.baseBranch?.trim() || '';
    if (!target) {
      const { stdout: parentBranch } = await execFileAsync(
        'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: workspace.parentRepo, timeout: 5000 },
      );
      target = parentBranch.trim() || 'HEAD';
    }

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
 *
 * IMPORTANT: A branch that never diverged (zero commits ahead of the merge
 * base) is NOT considered "merged" — `--is-ancestor` returns true trivially
 * when the branch tip equals the merge base, which was the root cause of
 * empty directories showing as merged.
 */
export async function isWorkspaceBranchMerged(workspace: Workspace): Promise<boolean> {
  try {
    let target = workspace.baseBranch?.trim() || '';
    if (!target) {
      const { stdout: parentBranch } = await execFileAsync(
        'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: workspace.parentRepo, timeout: 5000 },
      );
      target = parentBranch.trim() || 'HEAD';
    }

    // Get the workspace branch tip from the worktree
    const { stdout: branchTip } = await execFileAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: workspace.worktreePath, timeout: 5000 },
    );

    // Find the merge-base between the branch tip and the target
    const { stdout: mergeBaseOut } = await execFileAsync(
      'git', ['merge-base', branchTip.trim(), target],
      { cwd: workspace.parentRepo, timeout: 5000 },
    );
    const mergeBase = mergeBaseOut.trim();

    // If the branch tip IS the merge base, the branch never diverged.
    // This is NOT "merged" — it just never had any commits of its own.
    if (branchTip.trim() === mergeBase) {
      return false;
    }

    // The branch has diverged. Now check if it's been merged back.
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

type AttachmentPreview = {
  attachment: FileAttachment;
  text: string;
  truncated: boolean;
  binary: boolean;
  error?: string;
};

export interface AttachmentManifestEntry {
  type: 'image' | 'file';
  name: string;
  originalPath: string;
  /** Relative path inside `.context/` for materialized images. */
  diskPath?: string;
  mimeType?: string;
  sizeBytes?: number;
  truncated?: boolean;
  error?: string;
}

export interface AttachmentContextArtifacts {
  absolutePath: string;
  promptPath: string;
  manifestPath: string;
  imageCount: number;
  attachmentCount: number;
}

export interface SessionAttachmentContext {
  images?: string[];
  attachments?: FileAttachment[];
}

function dedupeAttachments(attachments: FileAttachment[]): FileAttachment[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = `${attachment.path}\u0000${attachment.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeImages(images: string[]): string[] {
  return [...new Set(images)];
}

function parseStoredImages(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return images.length > 0 ? dedupeImages(images) : undefined;
}

function parseStoredAttachments(value: unknown): FileAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const filePath = typeof entry.path === 'string' ? entry.path : null;
    const name = typeof entry.name === 'string' ? entry.name : null;
    if (!filePath || !name) return [];
    return [{ path: filePath, name }];
  });
  return attachments.length > 0 ? dedupeAttachments(attachments) : undefined;
}

function parseStoredMessagePayload(payloadJson: string | null | undefined): SessionAttachmentContext | null {
  const parsed = safeParse(payloadJson);
  if (!parsed) return null;
  const images = parseStoredImages(parsed.images);
  const attachments = parseStoredAttachments(parsed.attachments);
  if (!images?.length && !attachments?.length) return null;
  return { ...(images?.length ? { images } : {}), ...(attachments?.length ? { attachments } : {}) };
}

export function extractLatestSessionAttachmentContext(
  sessionStore: SessionStore,
  sessionId: string,
): SessionAttachmentContext | null {
  const messages = sessionStore.getMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user' || message.type !== 'text') continue;
    const context = parseStoredMessagePayload(message.payloadJson);
    if (context) return context;
  }
  return null;
}

async function collectAttachmentPreviews(
  attachments: FileAttachment[] | undefined,
): Promise<AttachmentPreview[]> {
  if (!attachments?.length) return [];

  const previews: AttachmentPreview[] = [];
  let remainingChars = MAX_TOTAL_ATTACHMENT_CHARS;

  for (const attachment of attachments.slice(0, MAX_ATTACHED_FILES)) {
    if (remainingChars <= 0) break;

    try {
      const preview = await readAttachmentPreview(
        attachment.path,
        Math.min(MAX_ATTACHMENT_CHARS_PER_FILE, remainingChars),
      );
      remainingChars -= preview.text.length;
      previews.push({
        attachment,
        text: preview.text,
        truncated: preview.truncated,
        binary: preview.binary,
      });
    } catch (err) {
      previews.push({
        attachment,
        text: '',
        truncated: false,
        binary: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return previews;
}

function formatAttachmentPreviewBlock(preview: AttachmentPreview): string {
  if (preview.error) {
    return `--- ${preview.attachment.name} (${preview.attachment.path}) ---\n[Unable to read attachment: ${preview.error}]`;
  }

  if (preview.binary) {
    return `--- ${preview.attachment.name} (${preview.attachment.path}) ---\n[Binary file omitted]`;
  }

  const suffix = preview.truncated ? '\n[Truncated attachment preview]' : '';
  return `--- ${preview.attachment.name} (${preview.attachment.path}) ---\n${preview.text}${suffix}`;
}

function inferImageExtension(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'bin';
  }
}

function parseDataUrlImage(image: string): { mediaType: string; buffer: Buffer; extension: string } | null {
  const match = image.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;

  const [, mediaType, data] = match;
  try {
    return {
      mediaType,
      buffer: Buffer.from(data, 'base64'),
      extension: inferImageExtension(mediaType),
    };
  } catch {
    return null;
  }
}

export async function writeAttachmentContextFile(
  cwd: string,
  options: {
    images?: string[];
    attachments?: FileAttachment[];
    sshHost: string | null;
  },
): Promise<AttachmentContextArtifacts | null> {
  const imageInputs = options.images?.length ? dedupeImages(options.images) : [];
  const attachments = options.attachments?.length ? dedupeAttachments(options.attachments) : [];
  if (imageInputs.length === 0 && attachments.length === 0) return null;

  try {
    const wfs = createWorkspaceFs(options.sshHost ?? undefined);
    const joinPath = wfs.isRemote ? path.posix.join : path.join;
    const contextDir = joinPath(cwd, '.context');
    const attachmentDir = joinPath(contextDir, 'attachments');
    await wfs.mkdirp(contextDir);
    await wfs.rmrf(attachmentDir);
    await wfs.mkdirp(attachmentDir);

    const manifest: AttachmentManifestEntry[] = [];
    const imageNotes: string[] = [];
    let persistedImageCount = 0;
    for (const [index, image] of imageInputs.entries()) {
      const parsed = parseDataUrlImage(image);
      if (!parsed) {
        imageNotes.push(`- Image ${index + 1}: [Unable to decode image attachment]`);
        manifest.push({ type: 'image', name: `image-${index + 1}`, originalPath: '', error: 'Unable to decode' });
        continue;
      }
      const relativeFile = `attachments/image-${index + 1}.${parsed.extension}`;
      const outputPath = joinPath(contextDir, relativeFile);
      await wfs.writeBuffer(outputPath, parsed.buffer);
      persistedImageCount += 1;
      imageNotes.push(`- Image ${index + 1}: \`${relativeFile}\` (${parsed.mediaType})`);
      manifest.push({
        type: 'image',
        name: `image-${index + 1}.${parsed.extension}`,
        originalPath: '',
        diskPath: relativeFile,
        mimeType: parsed.mediaType,
        sizeBytes: parsed.buffer.length,
      });
    }

    const previews = await collectAttachmentPreviews(attachments);
    for (const preview of previews) {
      manifest.push({
        type: 'file',
        name: preview.attachment.name,
        originalPath: preview.attachment.path,
        truncated: preview.truncated || undefined,
        error: preview.error || undefined,
      });
    }

    const failedImageCount = imageInputs.length - persistedImageCount;
    const lines: string[] = [
      '# Attachment Context',
      '',
      'Flux generated this file so agents can recover image and file attachments even when a CLI does not support native attachment input.',
      '',
      '## Summary',
      '',
      `- Images: ${persistedImageCount}${failedImageCount > 0 ? ` (${failedImageCount} could not be materialized)` : ''}`,
      `- File attachments: ${attachments.length}`,
    ];

    if (imageNotes.length > 0) {
      lines.push('', '## Images', '', ...imageNotes);
    }

    if (previews.length > 0) {
      lines.push('', '## File attachment previews', '');
      previews.forEach((preview, index) => {
        if (index > 0) lines.push('');
        lines.push(`### \`${preview.attachment.name}\``);
        lines.push(`Path: \`${preview.attachment.path}\``);
        lines.push('');
        if (preview.error) {
          lines.push(`[Unable to read attachment: ${preview.error}]`);
          return;
        }
        if (preview.binary) {
          lines.push('[Binary file omitted]');
          return;
        }
        lines.push(preview.text);
        if (preview.truncated) {
          lines.push('', '[Truncated attachment preview]');
        }
      });
    }

    if (attachments.length > MAX_ATTACHED_FILES) {
      lines.push('', `- Additional omitted attachments: ${attachments.length - MAX_ATTACHED_FILES}`);
    }

    const absolutePath = joinPath(contextDir, 'attachments.md');
    await wfs.writeFile(absolutePath, `${lines.join('\n')}\n`);

    const manifestPath = joinPath(contextDir, 'attachments.json');
    await wfs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    return {
      absolutePath,
      promptPath: '.context/attachments.md',
      manifestPath: '.context/attachments.json',
      imageCount: persistedImageCount,
      attachmentCount: attachments.length,
    };
  } catch (error) {
    logDiagnostic('attachments', 'failed to write attachment context', {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function buildAttachmentContextPrompt(
  context: AttachmentContextArtifacts | null,
): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.imageCount > 0) {
    parts.push(`${context.imageCount} image${context.imageCount === 1 ? '' : 's'}`);
  }
  if (context.attachmentCount > 0) {
    parts.push(`${context.attachmentCount} file attachment${context.attachmentCount === 1 ? '' : 's'}`);
  }
  const summary = parts.length > 0 ? parts.join(' and ') : 'attachments';
  return `Attachment context for ${summary} is saved at \`${context.promptPath}\`. Review that file if you need the original image files or fuller file previews.`;
}

export async function buildPromptWithAttachments(
  prompt: string,
  attachments: FileAttachment[] | undefined,
): Promise<string> {
  if (!attachments?.length) return prompt;

  const blocks = (await collectAttachmentPreviews(attachments)).map(formatAttachmentPreviewBlock);

  if (attachments.length > MAX_ATTACHED_FILES) {
    blocks.push(`[${attachments.length - MAX_ATTACHED_FILES} additional attachments omitted]`);
  }

  if (blocks.length === 0) return prompt;

  return `Attached file context:\n\n${blocks.join('\n\n')}\n\nUser request:\n${prompt}`;
}

async function readAttachmentPreview(
  filePath: string,
  maxChars: number,
): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  // Attachments originate on the local machine; SSH workspaces consume the
  // persisted .context artifacts instead of reading attachment paths remotely.
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
  /^flux\/[a-z]+-[a-z]+-[a-z0-9]{2}$/,        // adjective-animal-suffix like flux/quirky-newt-gi
  /^flux\/[a-z]+-[a-z]+$/,                     // fun names like flux/zagreb-lima
  /^flux\/[a-z]+-\d{1,3}$/,                    // element-number like flux/neon-42, flux/cobalt-17
  /^flux\/workspace-[a-z0-9-]+$/,              // flux/workspace-20260315-abc123
  /^flux\/[a-z0-9-]+-[a-z0-9]{6}$/,           // prompt-derived like flux/fix-token-refresh-abc123
  /^[a-z]+-[a-z]+-[a-z0-9]{2}$/,              // bare adjective-animal-suffix like quirky-newt-gi
  /^[a-z]+-[a-z]+(-v\d+)?$/,                   // bare fun names like zagreb-v2
  /^[a-z]+-\d{1,3}$/,                            // bare element-number like neon-42, cobalt-17
  /^workspace-\d{8}-[a-z0-9]+$/,               // workspace-20260315-abc123
];

export function isAutoGeneratedBranch(branch: string): boolean {
  return AUTO_BRANCH_PATTERNS.some((pattern) => pattern.test(branch));
}

export function buildWorkspaceSystemContext(
  workspace: Workspace,
  mode: SpawnOptions['mode'],
  options: {
    workspaceAction?: 'merge';
    merge?: {
      targetBranch: string;
      squash: boolean;
    };
    agentId?: AgentId;
    isExistingSession?: boolean;
    attachments?: {
      manifestPath: string;
      imageCount: number;
      fileCount: number;
    };
    siblingWorkspaces?: Array<{
      worktreePath: string;
      parentRepo: string;
      branch: string;
      label: string;
      role: 'primary' | 'sibling';
      outcome: WorkspaceOutcome;
    }>;
  } = {},
): string | null {
  if (options.workspaceAction === 'merge' && !options.merge) {
    throw new Error('Missing merge context for workspace merge task');
  }

  return composeSkillPrompts({
    agentId: options.agentId ?? 'claude-code',
    mode,
    workspaceAction: options.workspaceAction,
    isExistingSession: !!options.isExistingSession,
    isAutoGeneratedBranch: isAutoGeneratedBranch(workspace.branch),
    merge: options.merge,
    workspace: {
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
      parentRepo: workspace.parentRepo,
      outcome: workspace.outcome,
      direct: workspace.direct,
    },
    attachments: options.attachments,
    siblingWorkspaces: options.siblingWorkspaces,
  });
}

/**
 * Build a clean branch name from a human-readable label.
 * Produces `flux/<slug>` without a random suffix.
 */
export function branchNameFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
  return `flux/${slug}`;
}

// Match entire FLUX signal lines, including nested JSON payloads.
const FLUX_LINE_PATTERN = /^\s*FLUX_(?:WORKSPACE_LIFECYCLE|WORKSPACE|LIFECYCLE|SIGNAL):\s*\{.*$/gm;
// Match orphaned closing braces left behind when a streamed FLUX signal was
// split across chunks and only the closing fragment landed in this message.
const ORPHAN_JSON_CLOSER = /^\s*["']?\}\s*$/gm;

/** Strip FLUX protocol tokens so they don't leak into persisted plan text. */
export function stripFluxTokens(text: string): string {
  let cleaned = text.replace(FLUX_LINE_PATTERN, '');
  cleaned = cleaned.replace(ORPHAN_JSON_CLOSER, '');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

const PLAN_SECTION_PATTERN = /^#{2,3}\s+(summary|analysis|steps|trade-offs|tradeoffs|verification|considerations)\b/im;
const ORDERED_STEP_PATTERN = /^\d+\.\s+\S+/gm;
const BULLET_STEP_PATTERN = /^[-*]\s+\S+/gm;

/** Check whether text looks like a structured plan (mirrors renderer's isLikelyPlanText). */
function isLikelyPlanText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 80) return false;

  const planSections = (normalized.match(PLAN_SECTION_PATTERN) || []).length;
  const genericSections = (normalized.match(/^#{2,3}\s+\S+/gm) || []).length;
  const orderedSteps = (normalized.match(ORDERED_STEP_PATTERN) || []).length;
  const bulletSteps = (normalized.match(BULLET_STEP_PATTERN) || []).length;

  if (planSections >= 2 && (orderedSteps >= 1 || bulletSteps >= 3)) return true;
  if (genericSections >= 3 && orderedSteps >= 1) return true;
  return orderedSteps >= 3 && normalized.length >= 160;
}

export function extractFullPlanText(sessionStore: SessionStore, sessionId: string): string {
  const messages = sessionStore.getMessages(sessionId);
  // Search backwards for the most recent assistant message that looks like an actual plan
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 80) {
      const cleaned = stripFluxTokens(m.content);
      if (isLikelyPlanText(cleaned)) {
        return cleaned;
      }
    }
  }
  return '';
}

/**
 * Read plan text from `.context/plan.md` on disk — used as fallback when
 * the DB-based extraction returns nothing (e.g. after context compression).
 */
export function readPlanFileSync(cwd: string): string {
  try {
    const raw = fs.readFileSync(path.join(cwd, '.context', 'plan.md'), 'utf-8');
    return stripFluxTokens(raw);
  } catch {
    return '';
  }
}

export async function writePlanFile(cwd: string, planText: string): Promise<string | null> {
  if (!planText) return null;
  try {
    const contextDir = path.join(cwd, '.context');
    await fs.promises.mkdir(contextDir, { recursive: true });
    const planPath = path.join(contextDir, 'plan.md');

    // Don't overwrite an existing plan.md with content that doesn't look like a plan.
    // The agent may have written a good plan to disk that we failed to extract from messages.
    if (!isLikelyPlanText(planText)) {
      try {
        const existing = await fs.promises.readFile(planPath, 'utf-8');
        if (existing && isLikelyPlanText(existing)) {
          return planPath; // keep the existing good plan
        }
      } catch {
        // no existing file — write what we have
      }
    }

    await fs.promises.writeFile(planPath, planText, 'utf-8');
    return planPath;
  } catch {
    return null;
  }
}

/**
 * Clean a raw numbered-item title for display. Extracts the bold prefix
 * if the model wrote `**Title**: details`, otherwise truncates long titles.
 */
function cleanStepLabel(raw: string): string {
  const boldMatch = raw.match(/^\*\*(.+?)\*\*\s*[:–—-]/);
  if (boldMatch) return boldMatch[1].trim();
  const codeMatch = raw.match(/^`(.+?)`\s*[:–—-]/);
  if (codeMatch) return codeMatch[1].trim();
  if (raw.length > 80) return raw.slice(0, 80).replace(/\s+\S*$/, '').trim();
  return raw;
}

function parseTodoItemsFromText(text: string): { label: string }[] {
  const stepsMatch = text.match(/^#{2,3}\s+Steps?\b[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|\s*$)/im);
  const source = stepsMatch ? stepsMatch[1] : text;
  const items: { label: string }[] = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) items.push({ label: cleanStepLabel(match[1].trim()) });
  }
  return items;
}

export function extractPlanTodoItems(cwd: string, sessionStore: SessionStore, sessionId: string): { label: string }[] {
  // Prefer the filesystem — the agent writes plan.md directly and it's the most reliable source.
  const diskPlan = readPlanFileSync(cwd);
  if (diskPlan && isLikelyPlanText(diskPlan)) {
    const items = parseTodoItemsFromText(diskPlan);
    if (items.length > 0) return items;
  }

  // Fallback: scan session messages
  const messages = sessionStore.getMessages(sessionId);
  const planMsg = [...messages]
    .reverse()
    .find(m => {
      if (m.role !== 'assistant' || m.type !== 'text' || !m.content || m.content.length <= 80) return false;
      return isLikelyPlanText(stripFluxTokens(m.content));
    });
  if (!planMsg) return [];

  return parseTodoItemsFromText(stripFluxTokens(planMsg.content));
}

export function buildStepTrackingPrompt(steps: { label: string }[], agentId?: AgentId): string {
  if (steps.length === 0) return '';
  const list = steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n');

  // Claude CLI has its own native TodoWrite tool — don't inject Flux-specific
  // TodoWrite instructions. FLUX_WORKSPACE (already in the prompt) handles
  // progress tracking for all agents including claude-code.
  if (agentId === 'claude-code') {
    return [
      '',
      '## Plan steps',
      'Here are the steps to implement:',
      '',
      list,
      '',
      'IMPORTANT: Use your native TodoWrite tool to track progress on these steps.',
      'Write all steps as todo items at the start, then mark each as completed as you finish it.',
      'Do NOT write inline step markers like "Step 1:", "Step 2:" — use TodoWrite instead.',
      '',
    ].join('\n');
  }

  return [
    '',
    '## Progress tracking',
    'Here are the plan steps. As you work through them, output markers on their own line:',
    '- `[STEP <number> START: short description]` when you begin a step.',
    '- `[STEP <number> DONE]` when you complete a step.',
    '',
    list,
    '',
  ].join('\n');
}

export interface StepMarker {
  stepId: number;
  status: 'in_progress' | 'done';
  /** Optional short label extracted from `[STEP N START: label]` */
  label?: string;
}

/**
 * Scan a string for `[STEP N START]` / `[STEP N START: label]` and `[STEP N DONE]` markers.
 * Returns deduplicated markers — if a step appears as both START and DONE
 * in the same content block, the DONE wins (but preserves the label from START).
 */
export function parseStepMarkers(content: string): StepMarker[] {
  const markers = new Map<number, StepMarker>();

  // Match [STEP N START] or [STEP N START: some label]
  for (const m of content.matchAll(/\[STEP\s+(\d+)\s+START(?:\s*:\s*([^\]]*))?\]/gi)) {
    const stepId = parseInt(m[1], 10);
    const label = m[2]?.trim() || undefined;
    if (!markers.has(stepId)) {
      markers.set(stepId, { stepId, status: 'in_progress', label });
    }
  }

  for (const m of content.matchAll(/\[STEP\s+(\d+)\s+DONE\]/gi)) {
    const stepId = parseInt(m[1], 10);
    // DONE always wins over START, but preserve the label if we already have one
    const existing = markers.get(stepId);
    markers.set(stepId, { stepId, status: 'done', label: existing?.label });
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
    case 'result':
      return message.content;
    default:
      return null;
  }
}


const RATE_LIMIT_TYPE_ALIASES: Record<string, string> = {
  'five_hour': '5h', 'five hour': '5h', 'fivehour': '5h',
  '5_hour': '5h', '5 hour': '5h', '5h': '5h',
  'seven_day': '7d', 'seven day': '7d', 'sevenday': '7d',
  '7_day': '7d', '7 day': '7d', '7d': '7d',
  'daily': 'daily', 'minute': 'minute', '1m': 'minute',
};

function canonicalRateLimitType(raw: string): string {
  return RATE_LIMIT_TYPE_ALIASES[raw.toLowerCase().trim()] ?? raw;
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

  const resetsAt = raw.resetsAt ?? raw.resets_at ?? raw.resetAt ?? 0;
  const rateLimitType = canonicalRateLimitType(raw.rateLimitType ?? raw.rate_limit_type ?? raw.type ?? 'unknown');

  logDiagnostic('usage', `normalizeRateLimitInfo(${providerId}): stream event`, {
    rawKeys: Object.keys(raw),
    rawUtilization: raw.utilization,
    rawUsedPercent: raw.used_percent,
    rawPercentCapacity: raw.percentCapacity,
    rawStatus: raw.status,
    rawResetsAt: raw.resetsAt ?? raw.resets_at ?? raw.resetAt,
    rawRateLimitType: raw.rateLimitType ?? raw.rate_limit_type ?? raw.type,
    computedUtilization: utilization,
    computedResetsAt: resetsAt,
    computedRateLimitType: rateLimitType,
  });

  return {
    providerId,
    status: raw.status ?? (utilization >= 1 ? 'rejected' : utilization >= 0.8 ? 'allowed_warning' : 'allowed'),
    resetsAt,
    rateLimitType,
    utilization,
    ...(raw.fetchedAt ? { fetchedAt: raw.fetchedAt } : {}),
    ...(raw.overageStatus ? { overageStatus: raw.overageStatus } : {}),
    ...(raw.overageResetsAt ? { overageResetsAt: raw.overageResetsAt } : {}),
    ...(raw.overage_status ? { overageStatus: raw.overage_status } : {}),
    ...(raw.overage_resets_at ? { overageResetsAt: raw.overage_resets_at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Session context file — written at spawn and periodically during the session
// ---------------------------------------------------------------------------

const MAX_SESSION_CONTEXT_RESPONSE_CHARS = 12_000;

export async function writeSessionContextFile(
  cwd: string,
  sessionId: string,
  sessionStore: SessionStore,
  sshHost?: string | null,
): Promise<string | null> {
  try {
    const session = sessionStore.get(sessionId);
    if (!session) return null;

    const messages = sessionStore.getMessages(sessionId);
    if (!messages.length) return null;

    // ── Files discussed ──
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

    // ── Last assistant response ──
    const lastAssistant = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 100);
    const lastResponse = lastAssistant
      ? lastAssistant.content.length > MAX_SESSION_CONTEXT_RESPONSE_CHARS
        ? lastAssistant.content.slice(0, MAX_SESSION_CONTEXT_RESPONSE_CHARS) + '\n[truncated]'
        : lastAssistant.content
      : null;

    // ── Todo / progress items ──
    const todoItems: Array<{ label: string; status: string }> = [];
    for (const m of messages) {
      if (m.toolName === 'TodoWrite' && m.toolInput) {
        const input = safeParse(typeof m.toolInput === 'string' ? m.toolInput : JSON.stringify(m.toolInput));
        if (Array.isArray(input?.todos)) {
          todoItems.length = 0;
          for (const t of input.todos) {
            if (typeof t?.content === 'string') {
              todoItems.push({ label: t.content, status: t.status ?? 'pending' });
            }
          }
        }
      }
    }

    // ── Build markdown ──
    const sections: string[] = [
      '# Session Context',
      '',
      `> Auto-generated by Flux. Updated ${new Date().toISOString()}.`,
      '',
      '## Summary',
      '',
      `- **Session**: ${sessionId}`,
      `- **Agent**: ${session.agentId}`,
      `- **Mode**: ${session.mode}`,
      `- **Model**: ${session.model}`,
      `- **Working directory**: ${session.cwd}`,
    ];

    if (filePaths.size > 0) {
      sections.push('', '## Files Discussed', '');
      for (const f of [...filePaths].slice(0, 40)) {
        sections.push(`- ${f}`);
      }
    }

    if (toolActions.length > 0) {
      sections.push('', '## Recent Actions', '');
      for (const cmd of toolActions.slice(-15)) {
        sections.push(`- \`${cmd.slice(0, 150)}\``);
      }
    }

    if (lastResponse) {
      sections.push('', '## Last Assistant Response', '', lastResponse);
    }

    if (todoItems.length > 0) {
      sections.push('', '## Progress', '');
      for (const t of todoItems) {
        const marker = t.status === 'done' ? 'x' : ' ';
        const prefix = t.status === 'in_progress' ? '🔄 ' : '';
        sections.push(`- [${marker}] ${prefix}${t.label}`);
      }
    }

    const content = sections.join('\n') + '\n';
    const contextFilePath = `${cwd}/.context/session-context.md`;

    const wfs = createWorkspaceFs(sshHost ?? undefined);
    await wfs.writeFile(contextFilePath, content);
    return contextFilePath;
  } catch {
    return null;
  }
}
