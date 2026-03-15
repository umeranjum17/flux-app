import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { agentManager } from './agents/manager';
import { findLatestCodexSession } from './agents/codex-utils';
import { SessionStore } from './session/store';
import { ConfigManager } from './config/config';
import { UsageTracker } from './usage/tracker';
import { LiveUsageService } from './usage/live';
import type { AgentHandle, SpawnOptions, AgentId, AgentMessage, FileAttachment } from './agents/types';
import { setSshHost as setToolsSshHost } from './tools/ssh';
import { grepFiles } from './tools/grep';
import { repoMapService } from './intelligence/repomap';
import type { RepoMapConfig } from './config/types';
import { WorkspaceStore } from './worktree/store';
import { createWorktree, removeWorktree } from './worktree/manager';
import { generateWorkspaceName } from './worktree/names';
import { discardFile, getChangedFiles, getFileDiff } from './worktree/diff';
import { createCheckpoint, getCheckpointDiff, listCheckpoints, revertToCheckpoint } from './checkpoint/manager';
import type { Workspace, WorkspaceStatus, WorkspaceOutcome } from './worktree/types';
import { extendedEnv, resolveSshCommand, classifySpawnError, detectEnvironment } from './process-utils';
import { executeBash } from './tools/bash';
import { suggestCompletion, availableCompletionProviders } from './completion/service';
import { StallMonitor } from './agents/stall-monitor';
import { isInteractiveToolName } from './agents/claude';
import type { SdkAgentHandle } from './agents/claude-sdk';

const execFileAsync = promisify(execFile);
const MAX_ATTACHED_FILES = 6;
const MAX_ATTACHMENT_CHARS_PER_FILE = 12_000;
const MAX_TOTAL_ATTACHMENT_CHARS = 40_000;

function requireFields(obj: Record<string, unknown>, ...fields: string[]): void {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      throw new Error(`Missing required field: ${f}`);
    }
  }
}

console.log('[ipc-handlers] module loaded');
const activeTasks = new Map<string, AgentHandle>();
const taskSessions = new Map<string, string>();
const taskWorkspaceMap = new Map<string, string>(); // taskId → workspaceId
const taskWorkspaceStatusMap = new Map<string, WorkspaceStatus>();
const cleaningUp = new Set<string>();
const taskIdleHeartbeats = new Map<string, NodeJS.Timeout>();
const activeTerminals = new Map<string, ChildProcess>();
const taskStallMonitors = new Map<string, StallMonitor>();
const taskRetryCounts = new Map<string, number>();
const MAX_AUTO_RETRIES = 2;
const RECOVERY_DELAY_MS = 200;
const activeSubagents = new Map<string, {
  parentTaskId: string;
  handle: AgentHandle;
  name: string;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  sessionId: string;
}>();

interface RateLimitInfo {
  providerId: 'claude-code' | 'codex';
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt: number;
  rateLimitType: string;
  utilization: number;
  overageStatus?: string;
  overageResetsAt?: number;
  fetchedAt?: number;
}

const cachedRateLimits = new Map<string, RateLimitInfo>();

function normalizeRateLimitInfo(
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
let currentCwd = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
let localCwd = currentCwd;
let sshHost: string | null = null;

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toRemoteShellPath(value: string): string {
  const trimmed = value.trim() || '~';
  if (trimmed === '~') return '"$HOME"';
  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2);
    return rest ? `"${'$'}HOME"/${escapeShellArg(rest)}` : '"$HOME"';
  }
  return escapeShellArg(trimmed);
}

function expandLocalHomePath(value: string): string {
  const trimmed = value.trim() || '~';
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/')) return path.join(homeDir, trimmed.slice(2));
  return trimmed;
}

function buildSessionTitle(prompt: string): string {
  const nonEmptyLines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (nonEmptyLines[nonEmptyLines.length - 1] ?? 'Untitled').slice(0, 80);
}

function getAgentLabel(agentId: AgentId): string {
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

function serializePayload(payload: unknown): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(probe, [command], { timeout: 5000, env: extendedEnv() });
    return true;
  } catch {
    return false;
  }
}

function toStoredMessage(message: AgentMessage) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readAgentSessionId(metadata: Record<string, unknown> | undefined, agentId: AgentId): string | undefined {
  if (!metadata) return undefined;
  const agentSessions = metadata.agentSessions;
  if (!isRecord(agentSessions)) return undefined;
  const session = agentSessions[agentId];
  if (!isRecord(session)) return undefined;
  return typeof session.sessionId === 'string' ? session.sessionId : undefined;
}

async function runShellCommand(command: string, cwd: string, remoteHost: string | null): Promise<{
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

function buildUserMessagePayload(
  prompt: string,
  images?: string[],
  attachments?: FileAttachment[],
) : AgentMessage {
  return {
    type: 'text',
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
    ...(images?.length ? { images } : {}),
    ...(attachments?.length ? { attachments } : {}),
  };
}

function buildStoredUserMessage(
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

const AGENTS_WITH_NATIVE_RESUME = new Set<AgentId>(['claude-code', 'codex']);

/** Extract the full plan text from the most recent plan-like assistant message. */
function extractFullPlanText(sessionStore: SessionStore, sessionId: string): string {
  const messages = sessionStore.getMessages(sessionId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 80) {
      return m.content;
    }
  }
  return '';
}

/** Write the plan to .context/plan.md for clean handover between plan and act agents. */
async function writePlanFile(cwd: string, planText: string): Promise<string | null> {
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

/** Extract numbered steps from the plan text in session messages. */
function extractPlanTodoItems(sessionStore: SessionStore, sessionId: string): { label: string }[] {
  const messages = sessionStore.getMessages(sessionId);
  // Find the last substantial assistant message that looks like a plan
  const planMsg = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 80);
  if (!planMsg) return [];

  // Try to isolate the Steps section; fall back to whole text
  const stepsMatch = planMsg.content.match(/^#{2,3}\s+Steps?\b[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|\s*$)/im);
  const source = stepsMatch ? stepsMatch[1] : planMsg.content;
  const items: { label: string }[] = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) items.push({ label: match[1].trim() });
  }
  return items;
}

/** Build a step-tracking instruction block for the act prompt. */
function buildStepTrackingPrompt(steps: { label: string }[]): string {
  if (steps.length === 0) return '';
  const list = steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
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

function safeParse(input: string | null | undefined): Record<string, unknown> | null {
  if (!input) return null;
  try { return JSON.parse(input); } catch { return null; }
}

function buildConversationContext(sessionId: string, sessionStore: SessionStore, maxChars = 16_000): string {
  const messages = sessionStore.getMessages(sessionId);
  if (!messages.length) return '';

  // 1. Extract file paths from tool calls and shell commands
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

  // 2. Get the last substantial assistant response (most recent plan/analysis)
  const lastAssistant = [...messages]
    .reverse()
    .find(m => m.role === 'assistant' && m.type === 'text' && m.content && m.content.length > 100);

  // 3. Build recent user turns (compact)
  const userTurns = messages
    .filter(m => m.role === 'user' && m.type === 'text' && m.content)
    .slice(-5)
    .map(m => m.content);

  // 4. Compose structured output
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

interface DiffHunk { header: string; lines: string[] }
interface DiffFileEntry { path: string; additions: number; deletions: number; hunks: DiffHunk[] }
interface DiffData { files: DiffFileEntry[]; totalAdditions: number; totalDeletions: number }

async function captureGitSnapshot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function captureGitDiff(cwd: string, baseRef: string): Promise<DiffData | null> {
  try {
    const args = baseRef ? ['diff', baseRef, '--unified=3'] : ['diff', '--unified=3'];
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15000 });
    if (!stdout.trim()) return null;
    return parseUnifiedDiff(stdout);
  } catch {
    return null;
  }
}

function parseUnifiedDiff(raw: string): DiffData {
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

function toAbsoluteFilePath(root: string, file: string): string {
  if (path.isAbsolute(file)) return file;
  if (root === '/') return `/${file}`;
  return `${root.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}

async function buildPromptWithAttachments(
  prompt: string,
  attachments?: FileAttachment[],
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

/**
 * Build workspace-specific context to prepend to the agent prompt.
 * Gives the agent awareness of the workspace branch, working directory,
 * and post-completion expectations (commit, merge workflow).
 */
function buildWorkspaceSystemContext(
  workspace: Workspace,
  mode: SpawnOptions['mode'],
  workspaceAction?: 'merge',
): string | null {
  if (workspaceAction === 'merge') return null; // merge prompts are self-contained

  const lines = [
    `## Workspace Context`,
    `You are working in a dedicated workspace branch.`,
    `- Branch: \`${workspace.branch}\``,
    `- Working directory: \`${workspace.worktreePath}\``,
    `- Parent repository: \`${workspace.parentRepo}\``,
  ];

  if (mode === 'act') {
    lines.push(
      '',
      '## Instructions',
      '- Make the requested changes directly in the workspace.',
      '- Commit your changes with clear, descriptive commit messages when you are done.',
      '- Do NOT push to remote or create pull requests — the user will merge via the UI.',
      '- After committing, summarize what you changed.',
    );
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

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessionStore = new SessionStore();
  const configManager = new ConfigManager();
  const usageTracker = new UsageTracker();
  const liveUsageService = new LiveUsageService();
  const workspaceStore = new WorkspaceStore();
  const sendToRenderer = (channel: string, payload: unknown): boolean => {
    const windowClosed = typeof (mainWindow as BrowserWindow & { isDestroyed?: () => boolean }).isDestroyed === 'function'
      && (mainWindow as BrowserWindow & { isDestroyed: () => boolean }).isDestroyed();
    const webContentsClosed = typeof (mainWindow.webContents as typeof mainWindow.webContents & { isDestroyed?: () => boolean }).isDestroyed === 'function'
      && (mainWindow.webContents as typeof mainWindow.webContents & { isDestroyed: () => boolean }).isDestroyed();

    if (windowClosed || webContentsClosed) {
      return false;
    }

    try {
      mainWindow.webContents.send(channel, payload);
      return true;
    } catch (error) {
      console.warn(`[ipc-handlers] Failed to send ${channel}`, error);
      return false;
    }
  };
  const registeredChannels = [
    'env:detect',
    'agents:detect',
    'agents:check-auth',
    'agents:list-models',
    'task:spawn',
    'task:stop',
    'subagent:spawn',
    'subagent:stop',
    'task:approve',
    'task:deny',
    'task:answer-question',
    'task:steer',
    'sessions:list',
    'sessions:get',
    'sessions:delete',
    'sessions:messages',
    'config:get',
    'config:set',
    'theme:update-titlebar',
    'window:is-fullscreen',
    'zoom:set',
    'zoom:get',
    'usage:get',
    'usage:rate-limits',
    'usage:live',
    'cwd:get',
    'cwd:set',
    'cwd:pick',
    'git:branch',
    'git:status',
    'fs:readdir',
    'fs:read',
    'fs:grep',
    'fs:listdirs',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:kill',
    'ssh:test',
    'ssh:connect',
    'ssh:disconnect',
    'workspace:list',
    'workspace:create',
    'workspace:spawn',
    'workspace:spawn-chat',
    'workspace:list-chats',
    'workspace:stop',
    'workspace:delete',
    'workspace:archive',
    'workspace:unarchive',
    'workspace:open-ide',
    'workspace:diff-files',
    'workspace:file-diff',
    'workspace:discard-file',
    'checkpoint:list',
    'checkpoint:diff',
    'checkpoint:revert',
    'repomap:get-config',
    'repomap:set-config',
    'repomap:get-status',
    'repomap:rebuild',
    'repomap:preview',
    'shell:exec',
    'completion:suggest',
    'completion:providers',
  ];
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel);
  }

  const emitFullscreenChanged = () => {
    sendToRenderer('window:fullscreen-changed', { isFullscreen: mainWindow.isFullScreen() });
  };
  mainWindow.on('enter-full-screen', emitFullscreenChanged);
  mainWindow.on('leave-full-screen', emitFullscreenChanged);

  // --- Environment detection ---

  ipcMain.handle('env:detect', async () => {
    return detectEnvironment();
  });

  // --- Agent handlers ---

  ipcMain.handle('agents:detect', async () => {
    return agentManager.detectAll();
  });

  ipcMain.handle('agents:check-auth', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.checkAuth(agentId);
  });

  ipcMain.handle('agents:list-models', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.listModels(agentId as AgentId);
  });

  const emitWorkspaceStatus = (workspaceId: string, status: WorkspaceStatus, extra?: { sessionId?: string }) => {
    workspaceStore.update(workspaceId, {
      status,
      ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    });
    sendToRenderer('workspace:status', { workspaceId, status });
  };

  const emitWorkspaceOutcome = (workspaceId: string, outcome: WorkspaceOutcome) => {
    workspaceStore.update(workspaceId, { outcome });
    sendToRenderer('workspace:outcome', { workspaceId, outcome });
  };

  const aggregateWorkspaceStatus = (workspaceId: string): WorkspaceStatus => {
    const statuses = [...taskWorkspaceMap.entries()]
      .filter(([, mappedWorkspaceId]) => mappedWorkspaceId === workspaceId)
      .map(([taskId]) => taskWorkspaceStatusMap.get(taskId))
      .filter((status): status is WorkspaceStatus => !!status);

    if (statuses.includes('running')) return 'running';
    if (statuses.includes('waiting_approval')) return 'waiting_approval';
    if (statuses.includes('waiting_input')) return 'waiting_input';
    if (statuses.includes('error')) return 'error';
    if (statuses.length > 0 && statuses.every((status) => status === 'done')) return 'done';
    return 'done';
  };

  const updateWorkspaceTaskStatus = (
    taskId: string,
    workspaceId: string,
    status: WorkspaceStatus,
    extra?: { sessionId?: string },
  ) => {
    taskWorkspaceMap.set(taskId, workspaceId);
    taskWorkspaceStatusMap.set(taskId, status);
    emitWorkspaceStatus(workspaceId, aggregateWorkspaceStatus(workspaceId), extra);
  };

  const releaseWorkspaceTask = (taskId: string, fallbackStatus: WorkspaceStatus = 'done') => {
    const workspaceId = taskWorkspaceMap.get(taskId);
    taskWorkspaceStatusMap.delete(taskId);
    taskWorkspaceMap.delete(taskId);
    if (workspaceId) {
      const remaining = [...taskWorkspaceMap.values()].some((mappedWorkspaceId) => mappedWorkspaceId === workspaceId);
      emitWorkspaceStatus(workspaceId, remaining ? aggregateWorkspaceStatus(workspaceId) : fallbackStatus);
    }
    return workspaceId;
  };

  const resolveQualityGateCommands = async (_cwd: string): Promise<string[]> => {
    return configManager.get().qualityGateCommands
      .map((command) => command.trim())
      .filter(Boolean);
  };

  const emitQualityGateMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    sendToRenderer('agent:message', { taskId, message });
  };

  const emitTaskMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    sendToRenderer('agent:message', { taskId, message });
  };

  const emitSubagentMessage = (
    parentTaskId: string,
    subagentId: string,
    subagentName: string,
    message: AgentMessage,
  ) => {
    const payload: AgentMessage = {
      ...message,
      subagentId,
      subagentName,
      ...(message.subagentStatus ? {} : { subagentStatus: 'running' }),
    };
    sendToRenderer('agent:message', { taskId: parentTaskId, message: payload });
  };

  const persistAgentSessionId = (sessionId: string, agentId: AgentId, agentSessionId: string) => {
    const current = sessionStore.get(sessionId);
    if (!current) return;

    const baseMetadata = current.metadata ?? {};
    const currentAgentSessions = isRecord(baseMetadata.agentSessions)
      ? baseMetadata.agentSessions
      : {};
    const metadata = {
      ...baseMetadata,
      agentSessions: {
        ...currentAgentSessions,
        [agentId]: {
          sessionId: agentSessionId,
        },
      },
    };

    sessionStore.update(sessionId, { metadata });
  };

  const recordWorkspaceCheckpoint = async (workspaceId: string, prompt: string, sessionId: string) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const checkpoint = await createCheckpoint(
      workspace.worktreePath,
      workspaceId,
      sessionId,
      listCheckpoints(workspaceId).length + 1,
      buildSessionTitle(prompt),
    );
    sendToRenderer('workspace:checkpoint', { workspaceId, checkpoint });
  };

  const spawnTaskRun = async (
    options: SpawnOptions & {
      agentId?: string;
      autoApprovePermissions?: boolean;
      workspaceAction?: 'merge';
    },
  ) => {
    requireFields(options as unknown as Record<string, unknown>, 'taskId', 'prompt', 'cwd');
    const agentId = (options.agentId ?? 'claude-code') as AgentId;
    const workspace = options.workspaceId
      ? workspaceStore.get(options.workspaceId)
      : workspaceStore.get(options.taskId);
    if (activeTasks.has(options.taskId)) {
      // Defensive cleanup: the renderer may have fired task:stop but it hasn't
      // completed yet (race). Stop the stale handle and wait for process exit
      // to avoid "Session ID already in use" collisions.
      for (const [subagentId, subagent] of activeSubagents.entries()) {
        if (subagent.parentTaskId !== options.taskId) continue;
        await subagent.handle.stop();
        subagent.handle.removeAllListeners();
        activeSubagents.delete(subagentId);
        activeTasks.delete(subagentId);
        taskSessions.delete(subagentId);
      }
      const staleHandle = activeTasks.get(options.taskId)!;
      await staleHandle.stop();
      // Allow the CLI a moment to release its session lock file after exit,
      // preventing "Session ID already in use" errors on the next spawn.
      await new Promise(resolve => setTimeout(resolve, 500));
      staleHandle.removeAllListeners();
      activeTasks.delete(options.taskId);
      taskSessions.delete(options.taskId);
      taskWorkspaceStatusMap.delete(options.taskId);
      taskWorkspaceMap.delete(options.taskId);
      cleaningUp.delete(options.taskId);
      if (taskIdleHeartbeats.has(options.taskId)) {
        clearInterval(taskIdleHeartbeats.get(options.taskId)!);
        taskIdleHeartbeats.delete(options.taskId);
      }
    }

    let effectivePrompt = await buildPromptWithAttachments(options.prompt, options.attachments);

    const repoMapConfig = configManager.get().repoMap;
    if (repoMapConfig.enabled && repoMapConfig.perAgentEnabled[agentId] !== false) {
      try {
        const repoMap = await repoMapService.getMap(effectivePrompt, repoMapConfig.maxTokens);
        if (repoMap) {
          options.contextBlock = repoMap;
          effectivePrompt = repoMap + '\n\n' + effectivePrompt;
        }
      } catch {
        // Repo map generation failed — continue without it
      }
    }

    const existingSession = options.sessionId ? sessionStore.get(options.sessionId) : null;
    const session = existingSession ?? sessionStore.create({
      title: workspace ? `[WS] ${workspace.name}` : buildSessionTitle(options.prompt),
      agentId,
      model: options.model ?? '',
      mode: options.mode,
      cwd: options.cwd,
      metadata: workspace ? { workspaceId: workspace.id } : {},
    });
    const startedAt = Date.now();
    const existingAgentSessionId = readAgentSessionId(existingSession?.metadata, agentId);
    // CLI agents run locally — use localCwd when SSH is connected so spawn()
    // doesn't fail with ENOENT on a remote path that doesn't exist locally.
    const spawnCwd = sshHost ? localCwd : options.cwd;

    // For Claude Code over SSH: only pass --session-id when resuming a session
    // that had a previously confirmed agent session ID. New sessions should let
    // Claude auto-generate an ID to avoid "Session ID already in use" collisions.
    const claudeResumeId = sshHost
      ? existingAgentSessionId   // only resume if we captured a real Claude session ID before
      : session.id;              // local: always use Flux session ID

    // Pre-build conversation context so the agent can fall back to it
    // if native session resume fails (e.g., "Session ID already in use").
    const fallbackContext = existingSession
      ? buildConversationContext(session.id, sessionStore)
      : undefined;

    // Inject workspace context into the prompt so the agent understands
    // its workspace environment (branch, merge target, commit expectations).
    if (workspace && !existingSession) {
      const wsContext = buildWorkspaceSystemContext(workspace, options.mode, options.workspaceAction);
      if (wsContext) {
        effectivePrompt = `${wsContext}\n\n${effectivePrompt}`;
      }
    }

    const spawnOptions: SpawnOptions = {
      ...options,
      cwd: spawnCwd,
      remoteCwd: sshHost ? options.cwd : undefined,
      sshHost: sshHost ?? undefined,
      dangerouslyBypassPermissions: agentId === 'claude-code' || options.workspaceAction === 'merge',
      prompt: effectivePrompt,
      sessionId: agentId === 'claude-code' ? session.id : options.sessionId,
      resumeSessionId: agentId === 'codex'
        ? existingAgentSessionId
        : agentId === 'claude-code'
          ? claudeResumeId
          : undefined,
      fallbackContext: fallbackContext || undefined,
    };
    let detectedCodexSessionId: string | undefined = existingAgentSessionId;

    if (sshHost) {
      try {
        await execFileAsync(
          resolveSshCommand(),
          ['-o', 'ConnectTimeout=3', '-o', 'BatchMode=yes', sshHost, 'echo', 'ok'],
          { timeout: 5000, env: extendedEnv() },
        );
      } catch (err: any) {
        const info = classifySpawnError(err as Error, { command: 'ssh', sshHost });
        if (!existingSession) {
          sessionStore.delete(session.id);
        }
        throw new Error(`SSH connection failed: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`);
      }
    }

    // For OpenAI resume: load previous messages for context replay
    const resumeMessages = (agentId === 'openai' && existingSession)
      ? sessionStore.getMessages(session.id)
      : undefined;

    // Agent switch: inject structured conversation context when switching to a different agent
    const isAgentSwitch = existingSession && existingSession.agentId !== agentId;
    if (isAgentSwitch) {
      const fromAgent = getAgentLabel(existingSession.agentId as AgentId);
      // If plan→act across agents, pass the full plan (not truncated context)
      if (existingSession.mode === 'plan' && options.mode === 'act') {
        const planText = extractFullPlanText(sessionStore, session.id);
        const planPath = await writePlanFile(options.cwd, planText);
        const planSteps = extractPlanTodoItems(sessionStore, session.id);
        const stepTracking = buildStepTrackingPrompt(planSteps);
        spawnOptions.prompt = [
          `You are implementing a plan created by ${fromAgent}. The approved plan is below.`,
          planPath ? `The full plan is also saved at \`${planPath}\`.` : '',
          '',
          planText ? `## Approved Plan\n\n${planText}` : '',
          stepTracking,
          '',
          `## User instruction`,
          spawnOptions.prompt,
        ].filter(Boolean).join('\n');

        if (planSteps.length > 0) {
          const todoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
          sendToRenderer('agent:todo', { taskId: options.taskId, todoItems });
        }
      } else {
        const context = buildConversationContext(session.id, sessionStore);
        if (context) {
          spawnOptions.prompt = [
            `You are continuing a conversation previously handled by ${fromAgent}. Here is the context:`,
            '',
            context,
            '',
            `## Current request`,
            spawnOptions.prompt,
          ].join('\n');
        }
      }
    }

    // Context forwarding for continuations without working native resume
    const hasWorkingResume = AGENTS_WITH_NATIVE_RESUME.has(agentId) && !!spawnOptions.resumeSessionId;
    if (existingSession && !isAgentSwitch && !hasWorkingResume) {
      const isPlanToAct = existingSession.mode === 'plan' && options.mode === 'act';
      if (isPlanToAct) {
        // Plan→act: pass the full plan text (not truncated context)
        const planText = extractFullPlanText(sessionStore, session.id);
        const planPath = await writePlanFile(options.cwd, planText);
        const planSteps = extractPlanTodoItems(sessionStore, session.id);
        const stepTracking = buildStepTrackingPrompt(planSteps);
        spawnOptions.prompt = [
          'You are implementing an approved plan. The full plan is below.',
          planPath ? `The plan is also saved at \`${planPath}\`.` : '',
          '',
          planText ? `## Approved Plan\n\n${planText}` : '',
          stepTracking,
          '',
          `## Current request`,
          spawnOptions.prompt,
        ].filter(Boolean).join('\n');

        if (planSteps.length > 0) {
          const todoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
          sendToRenderer('agent:todo', { taskId: options.taskId, todoItems });
        }
      } else {
        const context = buildConversationContext(session.id, sessionStore);
        if (context) {
          spawnOptions.prompt = [
            `You are continuing a previous conversation. Here is the context:`,
            '',
            context,
            '',
            `## Current request`,
            spawnOptions.prompt,
          ].join('\n');
        }
      }
    }

    // Plan→act same-agent with native resume — session history has the plan,
    // but also write it to .context/plan.md for reference and resilience.
    if (existingSession && !isAgentSwitch && existingSession.mode === 'plan' && options.mode === 'act' && hasWorkingResume) {
      const planText = extractFullPlanText(sessionStore, session.id);
      const planPath = await writePlanFile(options.cwd, planText);
      const planSteps = extractPlanTodoItems(sessionStore, session.id);
      const stepTracking = buildStepTrackingPrompt(planSteps);
      spawnOptions.prompt = [
        'The user reviewed and approved the plan above. Implement each step now.',
        planPath ? `The full plan is also saved at \`${planPath}\`.` : '',
        stepTracking,
        '',
        spawnOptions.prompt,
      ].filter(Boolean).join('\n');

      if (planSteps.length > 0) {
        const todoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
        sendToRenderer('agent:todo', { taskId: options.taskId, todoItems });
      }
    }

    // Log when falling back from native resume to context injection
    if (existingSession && !isAgentSwitch && AGENTS_WITH_NATIVE_RESUME.has(agentId) && !spawnOptions.resumeSessionId) {
      emitTaskMessage(options.taskId, session.id, {
        type: 'status',
        role: 'system',
        statusKind: 'progress',
        content: 'Continuing with conversation context (session resume unavailable)',
        timestamp: Date.now(),
      });
    }

    // Capture git baseline for diff tracking
    const preRunRef = await captureGitSnapshot(options.cwd);

    // Capture quality gate baseline (pre-agent results) to detect pre-existing failures
    const qualityGateBaseline = new Map<string, boolean>();
    if (options.mode === 'act' && !sshHost) {
      const baselineCommands = await resolveQualityGateCommands(options.cwd);
      for (const cmd of baselineCommands) {
        const baseResult = await runShellCommand(cmd, options.cwd, sshHost);
        qualityGateBaseline.set(cmd, baseResult.exitCode === 0);
      }
    }

    let handle: AgentHandle;
    try {
      handle = agentManager.spawn(agentId, spawnOptions, resumeMessages);
    } catch (err) {
      if (!existingSession) {
        sessionStore.delete(session.id);
      }
      throw err;
    }

    if (existingSession) {
      sessionStore.update(session.id, {
        agentId,
        model: options.model ?? session.model,
        mode: options.mode,
        cwd: options.cwd,
        metadata: workspace ? { ...(session.metadata ?? {}), workspaceId: workspace.id } : session.metadata,
      });
    }

    if (workspace) {
      updateWorkspaceTaskStatus(options.taskId, workspace.id, 'running', { sessionId: session.id });
      if (
        options.workspaceAction !== 'merge'
        && options.mode === 'act'
        && (workspace.outcome === 'merged' || workspace.outcome === 'ready_to_archive')
      ) {
        emitWorkspaceOutcome(workspace.id, 'in_progress');
      }
    }

    if (options.prompt !== '[Resuming previous session]') {
      sessionStore.addMessage(
        session.id,
        buildStoredUserMessage(options.prompt, options.images, options.attachments),
      );
    }

    activeTasks.set(options.taskId, handle);
    taskSessions.set(options.taskId, session.id);
    if (workspace) {
      taskWorkspaceMap.set(options.taskId, workspace.id);
      taskWorkspaceStatusMap.set(options.taskId, 'running');
      workspaceStore.addSession(workspace.id, session.id, options.taskId);
    }

    // Idle heartbeat: emit periodic status while no tool heartbeat is active,
    // preventing false "Stalled" detection between tool executions.
    const idleHeartbeat = setInterval(() => {
      if (!activeTasks.has(options.taskId) || cleaningUp.has(options.taskId)) {
        clearInterval(idleHeartbeat);
        taskIdleHeartbeats.delete(options.taskId);
        return;
      }
      sendToRenderer('agent:message', {
        taskId: options.taskId,
        message: {
          type: 'status',
          role: 'system',
          statusKind: 'progress',
          content: 'Agent is working...',
          timestamp: Date.now(),
        } satisfies AgentMessage,
      });
    }, 10_000);
    taskIdleHeartbeats.set(options.taskId, idleHeartbeat);

    // Stall monitor: detect stuck tools and idle sessions on the main process side.
    // Disposes previous monitor if this is a retry.
    taskStallMonitors.get(options.taskId)?.dispose();
    const priorRetries = taskRetryCounts.get(options.taskId) ?? 0;
    const stallMonitor = new StallMonitor({
      taskId: options.taskId,
      maxAutoRestarts: Math.max(0, MAX_AUTO_RETRIES - priorRetries),
      onStallDetected: (info) => {
        // Safety net: ignore stall if the task is waiting for user interaction.
        const currentStatus = taskWorkspaceStatusMap.get(options.taskId);
        if (currentStatus === 'waiting_input' || currentStatus === 'waiting_approval') {
          stallMonitor.pause();
          return;
        }

        const label = info.type === 'tool_timeout'
          ? `${info.toolName ?? 'Tool'} timed out after ${Math.round(info.durationMs / 1000)}s`
          : `No activity for ${Math.round(info.durationMs / 1000)}s`;
        emitTaskMessage(options.taskId, session.id, {
          type: 'status',
          role: 'system',
          statusKind: 'diagnostic',
          content: `Stall detected: ${label}`,
          timestamp: Date.now(),
        });
        sendToRenderer('agent:stall', {
          taskId: options.taskId,
          stallInfo: info,
        });
        if (info.autoRestartsRemaining > 0) {
          void triggerAutoRecovery(options.taskId, session.id, agentId, options);
        }
      },
      onProcessDead: () => {
        if (!cleaningUp.has(options.taskId) && activeTasks.has(options.taskId)) {
          emitTaskMessage(options.taskId, session.id, {
            type: 'error',
            role: 'system',
            content: 'Agent process died unexpectedly',
            timestamp: Date.now(),
          });
          sendToRenderer('agent:done', { taskId: options.taskId, error: 'Agent process died unexpectedly' });
          cleanupTask(options.taskId);
        }
      },
    });
    taskStallMonitors.set(options.taskId, stallMonitor);

    // Start process health monitoring using the handle's isAlive method
    stallMonitor.startHealthCheck(() => handle.isAlive());

    emitTaskMessage(options.taskId, session.id, {
      type: 'status',
      role: 'system',
      statusKind: 'spawn',
      content: `Starting ${getAgentLabel(agentId)}...`,
      timestamp: Date.now(),
    });

    handle.on('session-meta', (meta) => {
      if (!meta || typeof meta !== 'object') {
        return;
      }

      const sessionMeta = meta as { id?: string };
      if (typeof sessionMeta.id !== 'string') {
        return;
      }

      if (agentId === 'codex') {
        detectedCodexSessionId = sessionMeta.id;
      }
      persistAgentSessionId(session.id, agentId, sessionMeta.id);
    });

    const toolHeartbeats = new Map<string, NodeJS.Timeout>();

    handle.on('message', (message) => {
      // Feed the stall monitor so it can track tool durations and idle time.
      if (message.type === 'tool_call' && message.toolCallId) {
        if (isInteractiveToolName(message.toolName)) {
          // Interactive MCP tools (ExitPlanMode, AskUserQuestion, etc.)
          // may wait for user interaction — pause stall detection.
          stallMonitor.pause();
        } else {
          stallMonitor.trackToolCall(message.toolCallId, message.toolName);
        }
      } else if (message.type === 'tool_result' && message.toolCallId) {
        stallMonitor.trackToolResult(message.toolCallId);
        // Resume stall monitoring if paused for an interactive tool.
        stallMonitor.resume();
      }
      if (message.type !== 'status' && message.type !== 'rate_limit') {
        stallMonitor.markActivity();
      }

      // Pause stall detection while waiting for user input/approval.
      if (message.type === 'question_request') {
        stallMonitor.pause();
      }

      if (message.type === 'rate_limit') {
        const normalized = (agentId === 'claude-code' || agentId === 'codex')
          ? normalizeRateLimitInfo(
            message.rateLimitInfo as Record<string, any> | undefined,
            agentId,
          )
          : null;
        if (normalized) {
          cachedRateLimits.set(`${normalized.providerId}:${normalized.rateLimitType}`, normalized);
        }
      }

      sessionStore.addMessage(session.id, toStoredMessage(message));

      // Detect step progress markers in assistant text and update todo state
      if (message.type === 'text' && message.role === 'assistant' && message.content) {
        const stepDoneMatches = message.content.matchAll(/\[STEP\s+(\d+)\s+DONE\]/gi);
        const stepStartMatches = message.content.matchAll(/\[STEP\s+(\d+)\s+START\]/gi);
        for (const m of stepStartMatches) {
          sendToRenderer('agent:todo-update', {
            taskId: options.taskId,
            stepId: parseInt(m[1], 10),
            status: 'in_progress',
          });
        }
        for (const m of stepDoneMatches) {
          sendToRenderer('agent:todo-update', {
            taskId: options.taskId,
            stepId: parseInt(m[1], 10),
            status: 'done',
          });
        }
      }

      const autoApprovePermission = Boolean(
        options.autoApprovePermissions
          && message.type === 'permission_request'
          && message.requestId,
      );

      if (workspace) {
        if (message.type === 'permission_request' && !autoApprovePermission) {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'waiting_approval', { sessionId: session.id });
        } else if (message.type === 'question_request') {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'waiting_input', { sessionId: session.id });
        } else if (message.type !== 'rate_limit') {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'running', { sessionId: session.id });
        }
      }

      if (message.type === 'permission_request') {
        if (autoApprovePermission) {
          handle.approve(message.requestId!);
          const autoApprovedMessage = {
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: `Auto-approved ${message.toolName ?? 'permission'} for workspace merge`,
            timestamp: Date.now(),
          } satisfies AgentMessage;
          sessionStore.addMessage(session.id, toStoredMessage(autoApprovedMessage));
          sendToRenderer('agent:message', {
            taskId: options.taskId,
            message: autoApprovedMessage,
          });
        } else {
          stallMonitor.pause();
          sendToRenderer('agent:permission', {
            taskId: options.taskId,
            requestId: message.requestId,
            toolName: message.toolName ?? 'unknown',
            description: message.content,
            action: message.action,
            path: message.filePath,
          });
        }
      }
      if (!(message.type === 'permission_request' && autoApprovePermission)) {
        sendToRenderer('agent:message', { taskId: options.taskId, message });
      }

      // Subagent streaming already provides rich progress; avoid repeating
      // generic parent tool heartbeats that look like a stuck loader.
      if (message.subagentId && toolHeartbeats.size > 0) {
        for (const interval of toolHeartbeats.values()) {
          clearInterval(interval);
        }
        toolHeartbeats.clear();
      }

      // Tool-execution heartbeats to prevent false "Stalled" detection
      if (message.type === 'tool_call' && message.toolCallId) {
        const heartbeatInterval = setInterval(() => {
          sendToRenderer('agent:message', {
            taskId: options.taskId,
            message: {
              type: 'status',
              role: 'system',
              statusKind: 'progress',
              content: `Running tool: ${message.toolName ?? 'unknown'}...`,
              timestamp: Date.now(),
            } satisfies AgentMessage,
          });
        }, 15_000);
        toolHeartbeats.set(message.toolCallId, heartbeatInterval);
      }

      if (message.type === 'tool_result' && message.toolCallId) {
        const interval = toolHeartbeats.get(message.toolCallId);
        if (interval) {
          clearInterval(interval);
          toolHeartbeats.delete(message.toolCallId);
        }
      }
    });

    handle.on('done', (result) => {
      void (async () => {
        if (cleaningUp.has(options.taskId)) return;

        // Dispose the stall monitor for this run.
        stallMonitor.dispose();
        taskStallMonitors.delete(options.taskId);

        for (const interval of toolHeartbeats.values()) clearInterval(interval);
        toolHeartbeats.clear();
        if (taskIdleHeartbeats.has(options.taskId)) {
          clearInterval(taskIdleHeartbeats.get(options.taskId)!);
          taskIdleHeartbeats.delete(options.taskId);
        }

        // Auto-retry on unexpected crash (not user-stopped, not auth/rate-limit).
        const retryCount = taskRetryCounts.get(options.taskId) ?? 0;
        const shouldAutoRetry = result?.error
          && !cleaningUp.has(options.taskId)
          && retryCount < MAX_AUTO_RETRIES
          && !result.error.includes('authentication')
          && !result.error.includes('rate limit')
          && !result.error.includes('timed out');
        if (shouldAutoRetry) {
          taskRetryCounts.set(options.taskId, retryCount + 1);
          emitTaskMessage(options.taskId, session.id, {
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: `Agent crashed — auto-retrying (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})...`,
            timestamp: Date.now(),
          });
          // Clean up current handle before respawn
          handle.removeAllListeners();
          activeTasks.delete(options.taskId);
          taskSessions.delete(options.taskId);
          await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));
          try {
            const context = buildConversationContext(session.id, sessionStore);
            await spawnTaskRun({
              ...options,
              sessionId: session.id,
              fallbackContext: context || undefined,
              prompt: '[Resuming previous session]',
            });
            return; // Don't emit agent:done — the retry takes over
          } catch {
            // Retry failed — fall through to normal done handling
          }
        }

        cleaningUp.add(options.taskId);
        try {
          let finalError = result?.error;

          for (const interval of toolHeartbeats.values()) clearInterval(interval);
          toolHeartbeats.clear();
          if (taskIdleHeartbeats.has(options.taskId)) {
            clearInterval(taskIdleHeartbeats.get(options.taskId)!);
            taskIdleHeartbeats.delete(options.taskId);
          }

          if (agentId === 'codex' && !detectedCodexSessionId) {
            const detectedSession = findLatestCodexSession(options.cwd, startedAt);
            if (detectedSession?.id) {
              detectedCodexSessionId = detectedSession.id;
              persistAgentSessionId(session.id, agentId, detectedSession.id);
            }
          }

          if (!finalError && options.mode === 'act') {
            const commands = await resolveQualityGateCommands(options.cwd);
            const maxRetries = configManager.get().qualityGateMaxRetries ?? 2;

            for (const command of commands) {
              let passed = false;
              let lastResult: { stdout: string; stderr: string; exitCode: number } = { stdout: '', stderr: '', exitCode: 0 };

              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const gateResult = await runShellCommand(command, options.cwd, sshHost);
                passed = gateResult.exitCode === 0;
                lastResult = gateResult;

                const gateMsg: AgentMessage = {
                  type: 'quality_gate',
                  role: 'system',
                  content: passed ? `Quality gate passed: ${command}` : `Quality gate failed: ${command}`,
                  timestamp: Date.now(),
                  command,
                  exitCode: gateResult.exitCode,
                  passed,
                  stdout: gateResult.stdout,
                  stderr: gateResult.stderr,
                  retryAttempt: attempt > 0 ? attempt : undefined,
                  maxRetries: attempt > 0 ? maxRetries : undefined,
                };
                emitQualityGateMessage(options.taskId, session.id, gateMsg);

                if (passed || attempt >= maxRetries) break;

                // Spawn a lightweight fix-up agent to address the errors
                const fixTaskId = crypto.randomUUID();
                const errorOutput = (gateResult.stderr || gateResult.stdout || '').trim();
                const fixPrompt = `The quality gate command \`${command}\` failed with these errors:\n\n\`\`\`\n${errorOutput}\n\`\`\`\n\nPlease fix these issues so the command passes.`;

                emitTaskMessage(options.taskId, session.id, {
                  type: 'status',
                  role: 'system',
                  statusKind: 'progress',
                  content: `Quality gate failed — attempting fix (${attempt + 1}/${maxRetries})...`,
                  timestamp: Date.now(),
                });

                const fixHandle = agentManager.spawn(agentId, {
                  taskId: fixTaskId,
                  prompt: fixPrompt,
                  cwd: spawnOptions.cwd,
                  mode: 'act',
                  model: spawnOptions.model,
                  binaryPath: spawnOptions.binaryPath,
                  sshHost: spawnOptions.sshHost,
                  remoteCwd: spawnOptions.remoteCwd,
                }, undefined);

                await new Promise<void>((resolve) => {
                  const safetyTimer = setTimeout(() => {
                    fixHandle.removeAllListeners();
                    resolve();
                  }, 120_000);

                  fixHandle.on('message', (msg: AgentMessage) => {
                    if (msg.type === 'permission_request' && msg.requestId) {
                      fixHandle.approve(msg.requestId);
                    } else if (msg.type !== 'result' && msg.type !== 'rate_limit') {
                      emitTaskMessage(options.taskId, session.id, msg);
                    }
                  });

                  fixHandle.on('done', () => {
                    clearTimeout(safetyTimer);
                    fixHandle.removeAllListeners();
                    resolve();
                  });
                });
              }

              if (!passed) {
                const baselinePassed = qualityGateBaseline.get(command);
                if (baselinePassed === false) {
                  // Pre-existing failure — warn but do not block
                  const preExistingMsg: AgentMessage = {
                    type: 'quality_gate',
                    role: 'system',
                    content: `Quality gate pre-existing failure (existed before agent ran): ${command}`,
                    timestamp: Date.now(),
                    command,
                    exitCode: lastResult.exitCode,
                    passed: false,
                    isPreExisting: true,
                    stdout: lastResult.stdout,
                    stderr: lastResult.stderr,
                  };
                  emitQualityGateMessage(options.taskId, session.id, preExistingMsg);
                } else {
                  finalError = `Quality gate failed: ${command}`;
                  break;
                }
              }
            }
          }

          // Capture post-run diff
          if (preRunRef && !sshHost) {
            try {
              const diffData = await captureGitDiff(options.cwd, preRunRef);
              if (diffData && diffData.files.length > 0) {
                const msgCount = (await (() => {
                  try { return sessionStore.getMessages(session.id).length; } catch { return 0; }
                })());
                const key = `0-${msgCount}`;
                sendToRenderer('agent:diff', {
                  taskId: options.taskId,
                  key,
                  diff: diffData,
                });
              }
            } catch {
              // Diff capture is best-effort
            }
          }

          sendToRenderer('agent:done', { taskId: options.taskId, error: finalError });

          if (workspace) {
            const nextStatus: WorkspaceStatus = finalError ? 'error' : 'done';
            updateWorkspaceTaskStatus(options.taskId, workspace.id, nextStatus, { sessionId: session.id });
            if (options.mode === 'act') {
              if (!finalError && options.workspaceAction === 'merge') {
                emitWorkspaceOutcome(workspace.id, 'merged');
              } else if (options.workspaceAction !== 'merge') {
                if (!finalError) {
                  await recordWorkspaceCheckpoint(workspace.id, options.prompt, session.id).catch(() => {
                    // Checkpoints are best-effort
                  });
                }

                // Auto-advance outcome to ready_for_pr if still in_progress.
                // Do this even on error — the agent may have committed work
                // before the error occurred (e.g., session lock errors).
                const currentWs = workspaceStore.get(workspace.id);
                if (currentWs && currentWs.outcome === 'in_progress') {
                  emitWorkspaceOutcome(workspace.id, 'ready_for_pr');
                }

                // Emit completion event so renderer can show merge prompts
                try {
                  const { stdout: branchOut } = await execFileAsync('git', ['branch', '--show-current'], { cwd: workspace.parentRepo });
                  const suggestedMergeTarget = branchOut.trim() || 'main';
                  sendToRenderer('workspace:completion', {
                    workspaceId: workspace.id,
                    taskId: options.taskId,
                    suggestedMergeTarget,
                  });
                } catch {
                  // Best-effort
                }
              }
            }
          }
        } finally {
          handle.removeAllListeners();
          activeTasks.delete(options.taskId);
          taskSessions.delete(options.taskId);
          taskWorkspaceStatusMap.delete(options.taskId);
          taskWorkspaceMap.delete(options.taskId);
          cleaningUp.delete(options.taskId);
          taskRetryCounts.delete(options.taskId);
          taskStallMonitors.get(options.taskId)?.dispose();
          taskStallMonitors.delete(options.taskId);
        }
      })();
    });

    return { taskId: options.taskId, session: sessionStore.get(session.id) ?? session };
  };

  /** Clean up a task's resources without emitting agent:done (used by stall monitor). */
  const cleanupTask = (taskId: string) => {
    const handle = activeTasks.get(taskId);
    if (handle) {
      handle.removeAllListeners();
      void handle.stop();
    }
    activeTasks.delete(taskId);
    taskSessions.delete(taskId);
    taskWorkspaceStatusMap.delete(taskId);
    taskWorkspaceMap.delete(taskId);
    taskRetryCounts.delete(taskId);
    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    cleaningUp.delete(taskId);
  };

  /** Stop the current agent and respawn with conversation context. */
  const triggerAutoRecovery = async (
    taskId: string,
    sessionId: string,
    agentId: AgentId,
    originalOptions: SpawnOptions & { agentId?: string; autoApprovePermissions?: boolean; workspaceAction?: 'merge' },
  ) => {
    const retryCount = taskRetryCounts.get(taskId) ?? 0;
    taskRetryCounts.set(taskId, retryCount + 1);

    const monitor = taskStallMonitors.get(taskId);
    if (monitor) {
      monitor.recordRestart();
      monitor.dispose();
    }

    emitTaskMessage(taskId, sessionId, {
      type: 'status',
      role: 'system',
      statusKind: 'progress',
      content: `Auto-recovering stalled session (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})...`,
      timestamp: Date.now(),
    });

    // Stop and clean up the current handle
    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
    }
    activeTasks.delete(taskId);
    taskSessions.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }

    await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));

    try {
      const context = buildConversationContext(sessionId, sessionStore);
      await spawnTaskRun({
        ...originalOptions,
        sessionId,
        fallbackContext: context || undefined,
        prompt: '[Resuming previous session]',
      });
    } catch (err) {
      sendToRenderer('agent:done', {
        taskId,
        error: `Recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      cleanupTask(taskId);
    }
  };

  // --- Task handlers ---

  ipcMain.handle(
    'task:spawn',
    async (
      _event,
      options: SpawnOptions & { agentId?: string; autoApprovePermissions?: boolean; workspaceAction?: 'merge' },
    ) => {
      return spawnTaskRun(options);
    },
  );

  ipcMain.handle('task:stop', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    if (cleaningUp.has(taskId)) return; // done handler already running
    cleaningUp.add(taskId);
    for (const [subagentId, subagent] of activeSubagents.entries()) {
      if (subagent.parentTaskId !== taskId) continue;
      await subagent.handle.stop();
      subagent.handle.removeAllListeners();
      activeSubagents.delete(subagentId);
      activeTasks.delete(subagentId);
      taskSessions.delete(subagentId);
    }
    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
      activeTasks.delete(taskId);
    }
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    taskRetryCounts.delete(taskId);
    taskSessions.delete(taskId);
    cleaningUp.delete(taskId);
    sendToRenderer('agent:done', { taskId, error: undefined });
    releaseWorkspaceTask(taskId, 'done');
  });

  ipcMain.handle('task:restart', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    const sessionId = taskSessions.get(taskId);
    if (!sessionId) throw new Error('No session for task');
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Stop the current agent
    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
    }
    activeTasks.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    taskSessions.delete(taskId);
    taskRetryCounts.delete(taskId);

    await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));

    const context = buildConversationContext(sessionId, sessionStore);
    return spawnTaskRun({
      taskId,
      sessionId,
      prompt: '[Resuming previous session]',
      cwd: session.cwd,
      mode: session.mode as 'plan' | 'act',
      model: session.model,
      agentId: session.agentId,
      fallbackContext: context || undefined,
    });
  });

  ipcMain.handle('subagent:spawn', async (_event, options: {
    parentTaskId: string;
    prompt: string;
    model?: string;
    name: string;
    cwd?: string;
  }) => {
    requireFields(options as unknown as Record<string, unknown>, 'parentTaskId', 'prompt', 'name');

    const parentHandle = activeTasks.get(options.parentTaskId);
    if (!parentHandle) {
      throw new Error(`Task ${options.parentTaskId} does not have an active run`);
    }

    const parentSessionId = taskSessions.get(options.parentTaskId);
    const parentSession = parentSessionId ? sessionStore.get(parentSessionId) : null;
    const parentAgentId = parentHandle.agentId;
    const config = configManager.get();
    const model = options.model || config.subagentModel || parentSession?.model || config.defaultModel;
    const subagentId = `${options.parentTaskId}:sub-${crypto.randomUUID().slice(0, 8)}`;
    const session = sessionStore.create({
      title: `[Subagent] ${options.name}`,
      agentId: parentAgentId,
      model,
      mode: 'plan',
      cwd: options.cwd ?? parentSession?.cwd ?? currentCwd,
      metadata: {
        parentTaskId: options.parentTaskId,
        subagentId,
        subagentName: options.name,
      },
    });

    const spawnOptions: SpawnOptions = {
      taskId: subagentId,
      prompt: options.prompt,
      model,
      mode: 'plan',
      thinking: 'low',
      cwd: options.cwd ?? parentSession?.cwd ?? currentCwd,
      sessionId: parentAgentId === 'claude-code' ? session.id : undefined,
      parentTaskId: options.parentTaskId,
      subagentName: options.name,
    };

    let handle: AgentHandle;
    try {
      handle = agentManager.spawn(parentAgentId, spawnOptions);
    } catch (error) {
      sessionStore.delete(session.id);
      throw error;
    }

    activeTasks.set(subagentId, handle);
    taskSessions.set(subagentId, session.id);
    activeSubagents.set(subagentId, {
      parentTaskId: options.parentTaskId,
      handle,
      name: options.name,
      toolCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      sessionId: session.id,
    });

    emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
      type: 'status',
      role: 'system',
      content: options.name,
      timestamp: Date.now(),
      statusKind: 'spawn',
      subagentStatus: 'spawning',
      subagentToolCount: 0,
      subagentTokens: {
        input: 0,
        output: 0,
      },
    });

    handle.on('session-meta', (meta) => {
      if (!meta || typeof meta !== 'object') {
        return;
      }
      const sessionMeta = meta as { id?: string };
      if (typeof sessionMeta.id !== 'string') {
        return;
      }
      persistAgentSessionId(session.id, parentAgentId, sessionMeta.id);
    });

    handle.on('message', (message) => {
      const subagent = activeSubagents.get(subagentId);
      if (!subagent) return;

      if (message.type === 'tool_call') {
        subagent.toolCount += 1;
      }
      if (message.type === 'result') {
        subagent.inputTokens += message.inputTokens ?? 0;
        subagent.outputTokens += message.outputTokens ?? 0;
      }

      sessionStore.addMessage(session.id, toStoredMessage(message));
      emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
        ...message,
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });
    });

    handle.on('done', (result) => {
      const subagent = activeSubagents.get(subagentId);
      if (!subagent) return;

      emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
        type: 'status',
        role: 'system',
        content: result?.error ? `${options.name} failed` : `${options.name} finished`,
        timestamp: Date.now(),
        statusKind: 'progress',
        subagentStatus: result?.error ? 'error' : 'done',
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });

      handle.removeAllListeners();
      activeSubagents.delete(subagentId);
      activeTasks.delete(subagentId);
      taskSessions.delete(subagentId);
    });

    return { subagentId };
  });

  ipcMain.handle('subagent:stop', async (_event, { subagentId, parentTaskId }: { subagentId?: string; parentTaskId?: string }) => {
    const targets = subagentId
      ? [subagentId]
      : Array.from(activeSubagents.entries())
        .filter(([, subagent]) => !parentTaskId || subagent.parentTaskId === parentTaskId)
        .map(([id]) => id);

    for (const targetId of targets) {
      const subagent = activeSubagents.get(targetId);
      if (!subagent) continue;
      await subagent.handle.stop();
      subagent.handle.removeAllListeners();
      activeSubagents.delete(targetId);
      activeTasks.delete(targetId);
      taskSessions.delete(targetId);
      emitSubagentMessage(subagent.parentTaskId, targetId, subagent.name, {
        type: 'status',
        role: 'system',
        content: `${subagent.name} stopped`,
        timestamp: Date.now(),
        statusKind: 'progress',
        subagentStatus: 'error',
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });
    }
  });

  ipcMain.handle('task:approve', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.approve(requestId);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:deny', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.deny(requestId);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:answer-question', async (_event, { taskId, requestId, response }: {
    taskId: string;
    requestId: string;
    response: string;
  }) => {
    requireFields({ taskId, requestId, response }, 'taskId', 'requestId', 'response');
    const handle = activeTasks.get(taskId);
    if (!handle) {
      throw new Error(`Task ${taskId} does not have an active run`);
    }

    if (!handle.isAlive()) {
      throw new Error('Agent process has exited — answer cannot be delivered');
    }

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      emitTaskMessage(taskId, sessionId, buildUserMessagePayload(response));
    }

    const workspaceId = taskWorkspaceMap.get(taskId);
    if (workspaceId) {
      updateWorkspaceTaskStatus(taskId, workspaceId, 'running', sessionId ? { sessionId } : undefined);
    }

    handle.answerQuestion(requestId, response);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:steer', async (_event, { taskId, prompt, images, attachments }: { taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }) => {
    const handle = activeTasks.get(taskId);
    if (!handle) {
      // Task already finished — signal renderer to fall back to spawn
      return { steerFailed: true, reason: 'task_finished' };
    }

    const effectivePrompt = await buildPromptWithAttachments(prompt, attachments);
    handle.steer(effectivePrompt, images);

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      sessionStore.addMessage(
        sessionId,
        buildStoredUserMessage(prompt, images, attachments),
      );
    }
    return { steerFailed: false };
  });

  // --- Session handlers ---

  ipcMain.handle('sessions:list', async () => {
    return sessionStore.listWithSummaries();
  });

  ipcMain.handle('sessions:get', async (_event, { id }: { id: string }) => {
    return sessionStore.get(id);
  });

  ipcMain.handle('sessions:delete', async (_event, { id }: { id: string }) => {
    return sessionStore.delete(id);
  });

  ipcMain.handle('sessions:messages', async (_event, { id }: { id: string }) => {
    return sessionStore.getMessages(id);
  });

  // --- Config handlers ---

  ipcMain.handle('config:get', async () => {
    return configManager.get();
  });

  ipcMain.handle('config:set', async (_event, partial: Record<string, unknown>) => {
    return configManager.set(partial);
  });

  // --- Theme / Window handlers ---

  ipcMain.handle('theme:update-titlebar', async (_event, { theme }: { theme: 'dark' | 'light' }) => {
    if (process.platform !== 'win32' || !mainWindow) return;
    mainWindow.setTitleBarOverlay({
      color: theme === 'dark' ? '#111217' : '#f7f9fb',
      symbolColor: theme === 'dark' ? '#aeb09d' : '#2f3a2f',
    });
  });

  ipcMain.handle('window:is-fullscreen', async () => {
    return mainWindow.isFullScreen();
  });

  // --- Zoom handlers ---

  ipcMain.handle('zoom:set', async (_event, { level }: { level: number }) => {
    const clamped = Math.max(0.5, Math.min(2.5, level));
    if (mainWindow) {
      mainWindow.webContents.setZoomFactor(clamped);
    }
    configManager.set({ zoomLevel: clamped } as any);
  });

  ipcMain.handle('zoom:get', async () => {
    return mainWindow?.webContents.getZoomFactor() ?? 1.0;
  });

  // --- Usage handlers ---

  ipcMain.handle('usage:get', async () => {
    return usageTracker.get();
  });

  ipcMain.handle('usage:rate-limits', async () => {
    return Array.from(cachedRateLimits.values());
  });

  ipcMain.handle('usage:live', async () => {
    return liveUsageService.getOverview(Array.from(cachedRateLimits.values()));
  });

  // --- CWD handlers ---

  ipcMain.handle('cwd:get', async () => {
    return currentCwd;
  });

  ipcMain.handle('cwd:set', async (_event, { cwd }: { cwd: string }) => {
    requireFields({ cwd }, 'cwd');
    currentCwd = cwd;
    if (!sshHost) {
      localCwd = cwd;
    }
    return currentCwd;
  });

  ipcMain.handle('cwd:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: currentCwd,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    currentCwd = result.filePaths[0];
    localCwd = currentCwd;
    return currentCwd;
  });

  // --- Git handlers ---

  ipcMain.handle('git:is-repo', async (_event, { dirPath }: { dirPath?: string } = {}) => {
    const target = dirPath ?? currentCwd;
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], {
        cwd: target,
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('git:branch', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: currentCwd });
      return stdout.trim();
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:upstream', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: currentCwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:status', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: currentCwd });
      return { dirty: stdout.trim().length > 0, files: stdout.trim() };
    } catch {
      return { dirty: false, files: '' };
    }
  });

  // --- Filesystem handlers ---

  ipcMain.handle('fs:readdir', async (_event, { dirPath, depth = 3 }: { dirPath?: string; depth?: number }) => {
    const targetDir = dirPath ?? currentCwd;
    const skipDirs = new Set(['node_modules', '.git', '.vite', 'dist', '.next', '__pycache__', '.cache']);

    interface TreeNode {
      name: string;
      path: string;
      isDirectory: boolean;
      children?: TreeNode[];
    }

    // SSH remote read
    if (sshHost) {
      try {
        const skipFilter = Array.from(skipDirs)
          .map((d) => `-name '${d}'`)
          .join(' -o ');
        const escapedDir = targetDir.replace(/'/g, "'\\''");
        const cmd = `find '${escapedDir}' -maxdepth ${depth} \\( ${skipFilter} \\) -prune -o -not -name '.*' \\( -type d -o -type f \\) -print | while IFS= read -r p; do if [ -d "$p" ]; then echo "d $p"; else echo "f $p"; fi; done`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [sshHost, cmd], {
          timeout: 15000,
          env: extendedEnv(),
        });

        const lines = stdout.trim().split('\n').filter(Boolean);
        // Build a map of path -> TreeNode
        const nodeMap = new Map<string, TreeNode>();
        const rootChildren: TreeNode[] = [];

        // Normalize targetDir (remove trailing slash)
        const normalizedRoot = targetDir.replace(/\/+$/, '');

        for (const line of lines) {
          const spaceIdx = line.indexOf(' ');
          if (spaceIdx === -1) continue;
          const type = line.charAt(0);
          const fullPath = line.substring(spaceIdx + 1);
          if (fullPath === normalizedRoot) continue;

          const name = fullPath.split('/').pop() || fullPath;
          if (name.startsWith('.') || skipDirs.has(name)) continue;

          const node: TreeNode = {
            name,
            path: fullPath,
            isDirectory: type === 'd',
          };
          if (type === 'd') node.children = [];
          nodeMap.set(fullPath, node);

          // Find parent
          const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
          const parent = nodeMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(node);
          } else if (parentPath === normalizedRoot || parentPath === '') {
            rootChildren.push(node);
          }
        }

        // Sort each level: directories first, then alphabetical
        function sortNodes(nodes: TreeNode[]): TreeNode[] {
          nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          for (const n of nodes) {
            if (n.children) sortNodes(n.children);
          }
          return nodes;
        }

        return sortNodes(rootChildren);
      } catch {
        return [];
      }
    }

    // Local read
    function readTree(dir: string, currentDepth: number): TreeNode[] {
      if (currentDepth <= 0) return [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
          .filter((e) => !e.name.startsWith('.') && !skipDirs.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((entry) => {
            const fullPath = path.join(dir, entry.name);
            const node: TreeNode = {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
            };
            if (entry.isDirectory()) {
              node.children = readTree(fullPath, currentDepth - 1);
            }
            return node;
          });
      } catch {
        return [];
      }
    }

    return readTree(targetDir, depth);
  });

  ipcMain.handle('fs:read', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (sshHost) {
        const { stdout } = await execFileAsync(resolveSshCommand(), [sshHost, `cat ${toRemoteShellPath(filePath)}`], {
          timeout: 10000,
          env: extendedEnv(),
        });
        return { content: stdout, error: null };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, error: null };
    } catch (err: any) {
      return { content: null, error: err.message };
    }
  });

  ipcMain.handle('fs:grep', async (_event, { pattern, cwd }: { pattern: string; cwd: string }) => {
    const results = await grepFiles(pattern, cwd);
    return results.map((result) => ({
      file: toAbsoluteFilePath(cwd, result.file),
      line: result.line,
      text: result.content,
    }));
  });

  // Remote directory listing for SSH folder picker
  ipcMain.handle('fs:listdirs', async (_event, { dirPath }: { dirPath: string }) => {
    const targetDir = dirPath || '~';
    try {
      if (sshHost) {
        // Resolve ~ and list directories + get the resolved path
        const cmd = `cd ${toRemoteShellPath(targetDir)} 2>/dev/null && pwd && ls -1pA 2>/dev/null | head -200`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [sshHost, cmd], {
          timeout: 10000,
          env: extendedEnv(),
        });
        const lines = stdout.trim().split('\n');
        const resolvedPath = lines[0] || targetDir;
        const entries = lines.slice(1).filter(Boolean).map((line) => ({
          name: line.replace(/\/$/, ''),
          isDirectory: line.endsWith('/'),
        }));
        return { path: resolvedPath, entries, error: null };
      }
      // Local fallback
      const resolved = path.resolve(expandLocalHomePath(targetDir));
      const dirEntries = fs.readdirSync(resolved, { withFileTypes: true });
      const entries = dirEntries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { path: resolved, entries, error: null };
    } catch (err: any) {
      return { path: targetDir, entries: [], error: err.message };
    }
  });

  // --- Terminal handlers ---

  ipcMain.handle('terminal:create', async (_event, { id, cwd: termCwd }: { id: string; cwd?: string }) => {
    requireFields({ id }, 'id');
    let shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    if (process.platform !== 'win32') {
      const preferred = process.env.SHELL;
      if (preferred && fs.existsSync(preferred)) {
        shell = preferred;
      }
    }
    const spawnCwd = sshHost ? localCwd : (termCwd ?? currentCwd);

    let proc: ChildProcess;

    if (sshHost) {
      proc = spawn(resolveSshCommand(), ['-tt', sshHost], {
        cwd: spawnCwd,
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (termCwd && proc.stdin?.writable) {
        proc.stdin.write(`cd ${toRemoteShellPath(termCwd)}\n`);
      }
    } else {
      const shellArgs = process.platform === 'win32' ? ['-NoLogo', '-NoExit'] : ['-i'];
      proc = spawn(shell, shellArgs, {
        cwd: spawnCwd,
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    activeTerminals.set(id, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      sendToRenderer('terminal:data', { id, data: data.toString() });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      sendToRenderer('terminal:data', { id, data: data.toString() });
    });

    proc.on('exit', () => {
      activeTerminals.delete(id);
      sendToRenderer('terminal:exit', { id });
    });

    return { id };
  });

  ipcMain.handle('terminal:write', async (_event, { id, data }: { id: string; data: string }) => {
    const proc = activeTerminals.get(id);
    if (proc?.stdin?.writable) proc.stdin.write(data);
  });

  ipcMain.handle('terminal:resize', async (_event, { id: _id, cols: _cols, rows: _rows }: { id: string; cols: number; rows: number }) => {
    // resize not supported without node-pty — no-op
  });

  ipcMain.handle('terminal:kill', async (_event, { id }: { id: string }) => {
    const proc = activeTerminals.get(id);
    if (proc) {
      proc.kill();
      activeTerminals.delete(id);
    }
  });

  // --- SSH handlers ---

  ipcMain.handle('ssh:test', async (_event, { host }: { host: string }) => {
    try {
      await execFileAsync(resolveSshCommand(), ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], {
        timeout: 10000,
        env: extendedEnv(),
      });
      return { success: true, error: null };
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      return { success: false, error: `${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}` };
    }
  });

  ipcMain.handle('ssh:connect', async (_event, { host, remoteCwd }: { host: string; remoteCwd?: string }) => {
    // Verify SSH connectivity before committing
    try {
      await execFileAsync(resolveSshCommand(), ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], {
        timeout: 10000,
        env: extendedEnv(),
      });
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      throw new Error(`SSH connection failed: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`);
    }
    sshHost = host;
    setToolsSshHost(host);
    localCwd = currentCwd;
    if (remoteCwd) currentCwd = remoteCwd;
    // Detect agents available on the remote host (non-blocking, runs concurrently)
    await agentManager.detectAllRemote(host).catch(() => {});
    return { connected: true };
  });

  ipcMain.handle('ssh:disconnect', async () => {
    sshHost = null;
    setToolsSshHost(null);
    currentCwd = localCwd;
    // Re-detect local agents after disconnecting from SSH
    agentManager.detectAll().catch(() => {});
    return { connected: false, cwd: currentCwd };
  });

  // --- Workspace handlers ---

  ipcMain.handle('workspace:list', async (_event, { parentRepo, includeArchived }: { parentRepo: string; includeArchived?: boolean }) => {
    if (sshHost) return [];
    return workspaceStore.list(parentRepo, includeArchived);
  });

  ipcMain.handle(
    'workspace:create',
    async (
      _event,
      {
        name,
        parentRepo,
        branch,
        agentId,
        model,
      }: {
        name: string;
        parentRepo: string;
        branch: string;
        agentId: string;
        model: string;
      },
    ) => {
      requireFields({ name, parentRepo, branch, agentId, model }, 'name', 'parentRepo', 'branch', 'agentId', 'model');
      if (sshHost) {
        throw new Error('Workspaces are only supported for local repositories right now');
      }

      try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
      } catch {
        throw new Error(
          `"${parentRepo}" is not a git repository. Run "git init" in that folder first, then try again.`,
        );
      }

      const worktree = await createWorktree(parentRepo, branch, branch);
      return workspaceStore.create({
        id: worktree.id,
        name,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        agentId,
        model,
        status: 'idle',
      });
    },
  );

  ipcMain.handle(
    'workspace:create-quick',
    async (
      _event,
      { parentRepo, agentId, model }: { parentRepo: string; agentId: string; model: string },
    ) => {
      requireFields({ parentRepo, agentId, model }, 'parentRepo', 'agentId', 'model');
      if (sshHost) {
        throw new Error('Workspaces are only supported for local repositories right now');
      }

      try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
      } catch {
        throw new Error(
          `"${parentRepo}" is not a git repository. Run "git init" in that folder first, then try again.`,
        );
      }

      const workspaceName = generateWorkspaceName();
      const branch = `flux/${workspaceName}`;
      const worktree = await createWorktree(parentRepo, branch, workspaceName);
      return workspaceStore.create({
        id: worktree.id,
        name: workspaceName,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        agentId,
        model,
        status: 'idle',
      });
    },
  );

  ipcMain.handle(
    'workspace:rename-branch',
    async (
      _event,
      {
        workspaceId,
        newBranch,
        newName,
        newWorktreeName,
      }: { workspaceId: string; newBranch: string; newName?: string; newWorktreeName?: string },
    ) => {
      requireFields({ workspaceId, newBranch }, 'workspaceId', 'newBranch');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const trimmedName = newName?.trim();
      const trimmedWorktreeName = newWorktreeName
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);

      let nextWorktreePath = workspace.worktreePath;
      if (trimmedWorktreeName) {
        const worktreeDir = path.dirname(workspace.worktreePath);
        let candidatePath = path.join(worktreeDir, trimmedWorktreeName);
        if (candidatePath !== workspace.worktreePath && fs.existsSync(candidatePath)) {
          for (let i = 2; i <= 999; i += 1) {
            const suffix = `-${i}`;
            const base = trimmedWorktreeName.slice(0, Math.max(1, 64 - suffix.length));
            const candidate = path.join(worktreeDir, `${base}${suffix}`);
            if (!fs.existsSync(candidate)) {
              candidatePath = candidate;
              break;
            }
          }
        }
        if (candidatePath !== workspace.worktreePath) {
          try {
            await execFileAsync('git', ['worktree', 'move', workspace.worktreePath, candidatePath], {
              cwd: workspace.parentRepo,
              timeout: 30000,
            });
            nextWorktreePath = candidatePath;
          } catch (error) {
            console.warn('[workspace:rename-branch] failed to move worktree path', error);
          }
        }
      }

      let nextBranch = workspace.branch;
      if (newBranch.trim() && newBranch !== workspace.branch) {
        try {
          await execFileAsync('git', ['branch', '-m', workspace.branch, newBranch], {
            cwd: nextWorktreePath,
            timeout: 10000,
          });
          nextBranch = newBranch;
        } catch (error) {
          console.warn('[workspace:rename-branch] failed to rename branch', error);
        }
      }

      const updated = workspaceStore.update(workspaceId, {
        branch: nextBranch,
        worktreePath: nextWorktreePath,
        ...(trimmedName ? { name: trimmedName } : {}),
      });
      if (!updated) throw new Error(`Workspace ${workspaceId} not found`);
      return updated;
    },
  );

  ipcMain.handle(
    'workspace:spawn',
    async (_event, { workspaceId, prompt, mode = 'act' }: { workspaceId: string; prompt: string; mode?: SpawnOptions['mode'] }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const taskId = crypto.randomUUID();
      const result = await spawnTaskRun({
        taskId,
        workspaceId: workspace.id,
        prompt,
        agentId: workspace.agentId,
        model: workspace.model,
        mode,
        cwd: workspace.worktreePath,
        sessionId: workspace.sessionId,
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:spawn-chat',
    async (_event, { workspaceId, prompt, mode = 'act', agentId: overrideAgentId, model: overrideModel, images, attachments }: {
      workspaceId: string;
      prompt: string;
      mode?: SpawnOptions['mode'];
      agentId?: string;
      model?: string;
      images?: string[];
      attachments?: FileAttachment[];
    }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const taskId = crypto.randomUUID();
      const result = await spawnTaskRun({
        taskId,
        workspaceId: workspace.id,
        prompt,
        agentId: (overrideAgentId ?? workspace.agentId) as any,
        model: overrideModel ?? workspace.model,
        mode,
        cwd: workspace.worktreePath,
        images,
        attachments,
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:list-chats',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      return workspaceStore.listSessions(workspaceId);
    },
  );

  ipcMain.handle('workspace:stop', async (_event, { workspaceId }: { workspaceId: string }) => {
    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      if (cleaningUp.has(taskId)) continue;
      cleaningUp.add(taskId);
      for (const [subId, sub] of activeSubagents.entries()) {
        if (sub.parentTaskId !== taskId) continue;
        await sub.handle.stop();
        sub.handle.removeAllListeners();
        activeSubagents.delete(subId);
        activeTasks.delete(subId);
        taskSessions.delete(subId);
      }
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      if (taskIdleHeartbeats.has(taskId)) {
        clearInterval(taskIdleHeartbeats.get(taskId)!);
        taskIdleHeartbeats.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
      cleaningUp.delete(taskId);
      sendToRenderer('agent:done', { taskId, error: undefined });
    }

    emitWorkspaceStatus(workspaceId, 'done');
  });

  ipcMain.handle('workspace:delete', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
    }

    await removeWorktree(workspace.parentRepo, workspace.worktreePath);
    workspaceStore.delete(workspaceId);
  });

  ipcMain.handle(
    'workspace:set-outcome',
    async (_event, { workspaceId, outcome }: { workspaceId: string; outcome: string }) => {
      emitWorkspaceOutcome(workspaceId, outcome as WorkspaceOutcome);
    },
  );

  ipcMain.handle(
    'workspace:update',
    async (_event, { workspaceId, agentId, model }: { workspaceId: string; agentId?: string; model?: string }) => {
      workspaceStore.update(workspaceId, {
        ...(agentId ? { agentId: agentId as AgentId } : {}),
        ...(model ? { model } : {}),
      });
    },
  );

  ipcMain.handle('workspace:archive', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    // Stop any running tasks
    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
    }

    // Remove the worktree to free disk space, but keep the branch
    try {
      await execFileAsync('git', ['worktree', 'remove', workspace.worktreePath, '--force'], {
        cwd: workspace.parentRepo,
        timeout: 30000,
      });
    } catch {
      // Worktree may already be gone
    }

    workspaceStore.archive(workspaceId);
    emitWorkspaceStatus(workspaceId, 'idle');
  });

  ipcMain.handle('workspace:unarchive', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    // Re-create the worktree from the preserved branch
    await execFileAsync('git', ['worktree', 'add', workspace.worktreePath, workspace.branch], {
      cwd: workspace.parentRepo,
      timeout: 30000,
    });

    const restored = workspaceStore.unarchive(workspaceId);
    if (!restored) throw new Error('Failed to unarchive workspace');
    return restored;
  });

  ipcMain.handle(
    'workspace:open-ide',
    async (
      _event,
      {
        workspaceId,
        ide,
      }: {
        workspaceId: string;
        ide?: 'code' | 'cursor' | 'zed';
      },
    ) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const configured = configManager.get().preferredIde;
      const preferred = ide ?? configured ?? 'code';
      const ordered: Array<'code' | 'cursor' | 'zed'> = [
        preferred,
        ...(['code', 'cursor', 'zed'] as const).filter((candidate) => candidate !== preferred),
      ];

      let selected: 'code' | 'cursor' | 'zed' | null = null;
      for (const candidate of ordered) {
        if (await commandExists(candidate)) {
          selected = candidate;
          break;
        }
      }

      if (!selected) {
        throw new Error('No supported IDE command found on PATH (code, cursor, zed)');
      }

      await execFileAsync(selected, ['--new-window', workspace.worktreePath], {
        cwd: workspace.worktreePath,
        timeout: 10000,
        env: extendedEnv(),
      });
      return { ide: selected };
    },
  );

  ipcMain.handle('workspace:diff-files', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    const files = await getChangedFiles(workspace.worktreePath, workspace.parentRepo);
    return files;
  });

  ipcMain.handle(
    'workspace:file-diff',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      return getFileDiff(workspace.worktreePath, filePath, workspace.parentRepo);
    },
  );

  ipcMain.handle(
    'workspace:discard-file',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      await discardFile(workspace.worktreePath, filePath, workspace.parentRepo);
    },
  );

  ipcMain.handle('checkpoint:list', async (_event, { workspaceId }: { workspaceId: string }) => {
    return listCheckpoints(workspaceId);
  });

  ipcMain.handle('checkpoint:diff', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return getCheckpointDiff(checkpointId, workspace.worktreePath);
  });

  ipcMain.handle('checkpoint:revert', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    await revertToCheckpoint(workspace.worktreePath, checkpointId);
    emitWorkspaceStatus(workspaceId, 'done');
  });

  // --- Repo Map handlers ---

  ipcMain.handle('repomap:get-config', async () => {
    return repoMapService.getConfig();
  });

  ipcMain.handle('repomap:set-config', async (_event, config: RepoMapConfig) => {
    const fullConfig = configManager.get();
    configManager.set({ repoMap: config });
    repoMapService.setConfig(config);
    // Re-init if enabled state changed
    if (config.enabled !== fullConfig.repoMap.enabled || config.enabled) {
      await repoMapService.init(currentCwd, config);
    }
  });

  ipcMain.handle('repomap:get-status', async () => {
    return repoMapService.getStatus();
  });

  ipcMain.handle('repomap:rebuild', async () => {
    await repoMapService.rebuild();
  });

  ipcMain.handle('repomap:preview', async (_event, { prompt }: { prompt: string }) => {
    const config = configManager.get().repoMap;
    return repoMapService.getMap(prompt, config.maxTokens);
  });

  ipcMain.handle('diff:get', async (_event, { taskId, sessionId }: { taskId: string; sessionId: string }) => {
    const session = sessionStore.get(sessionId);
    if (!session) return null;
    return captureGitDiff(session.cwd, '');
  });

  // --- Shell exec handler ---

  ipcMain.handle('shell:exec', async (_event, { command, cwd, timeout }: { command: string; cwd: string; timeout?: number }) => {
    const start = Date.now();
    const result = await executeBash(command, cwd, timeout ?? 30000);
    const durationMs = Date.now() - start;
    // Truncate output to 64KB
    const cap = 64 * 1024;
    return {
      stdout: result.stdout.slice(0, cap),
      stderr: result.stderr.slice(0, cap),
      exitCode: result.exitCode,
      durationMs,
    };
  });

  ipcMain.handle('completion:suggest', async (_event, { prefix, cwd, recentCommands, model }: { prefix: string; cwd: string; recentCommands: string[]; model?: string }) => {
    const result = await suggestCompletion(prefix, cwd, recentCommands, model);
    return result;
  });

  ipcMain.handle('completion:providers', () => {
    return { providers: availableCompletionProviders() };
  });

  // ---- MCP server management (Phase 4) ----

  ipcMain.handle('mcp:status', async (_event, { taskId }: { taskId: string }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('getMcpServerStatus' in handle)) return [];
    return (handle as SdkAgentHandle).getMcpServerStatus();
  });

  ipcMain.handle('mcp:reconnect', async (_event, { taskId, serverName }: { taskId: string; serverName: string }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('reconnectMcpServer' in handle)) return;
    await (handle as SdkAgentHandle).reconnectMcpServer(serverName);
  });

  ipcMain.handle('mcp:toggle', async (_event, { taskId, serverName, enabled }: { taskId: string; serverName: string; enabled: boolean }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('toggleMcpServer' in handle)) return;
    await (handle as SdkAgentHandle).toggleMcpServer(serverName, enabled);
  });

  // Initialize repo map if enabled
  const initialConfig = configManager.get().repoMap;
  if (initialConfig.enabled) {
    repoMapService.init(currentCwd, initialConfig).catch(() => {
      // Initialization error is non-fatal
    });
  }

  // Push status updates to renderer
  repoMapService.onStatusChange((status) => {
    sendToRenderer('repomap:status', status);
  });
}

export function cleanupProcesses(): void {
  for (const [, proc] of activeTerminals) {
    try { proc.kill(); } catch {}
  }
  activeTerminals.clear();
  for (const [, handle] of activeTasks) {
    try { handle.stop(); } catch {}
  }
  activeTasks.clear();
}
