import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { agentManager } from './agents/manager';
import { findLatestCodexSession } from './agents/codex-utils';
import { SessionStore } from './session/store';
import { ConfigManager } from './config/config';
import { UsageTracker } from './usage/tracker';
import type { AgentHandle, SpawnOptions, AgentId, AgentMessage, FileAttachment } from './agents/types';
import { setSshHost as setToolsSshHost } from './tools/ssh';
import { grepFiles } from './tools/grep';
import { repoMapService } from './intelligence/repomap';
import type { RepoMapConfig } from './config/types';
import { WorkspaceStore } from './worktree/store';
import { createWorktree, mergeWorktree, removeWorktree } from './worktree/manager';
import { discardFile, getChangedFiles, getFileDiff } from './worktree/diff';
import { createCheckpoint, getCheckpointDiff, listCheckpoints, revertToCheckpoint } from './checkpoint/manager';
import type { WorkspaceStatus } from './worktree/types';
import { extendedEnv, resolveSshCommand, classifySpawnError } from './process-utils';

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

const activeTasks = new Map<string, AgentHandle>();
const taskSessions = new Map<string, string>();
const cleaningUp = new Set<string>();
const activeTerminals = new Map<string, ChildProcess>();

interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  utilization: number;
  overageStatus?: string;
  overageResetsAt?: number;
}

let cachedRateLimits: RateLimitInfo | null = null;

function normalizeRateLimitInfo(raw: Record<string, any> | undefined | null): RateLimitInfo | null {
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
    status: raw.status ?? (utilization >= 1 ? 'rejected' : utilization >= 0.8 ? 'allowed_warning' : 'allowed'),
    resetsAt: raw.resetsAt ?? raw.resets_at ?? raw.resetAt ?? 0,
    rateLimitType: raw.rateLimitType ?? raw.rate_limit_type ?? raw.type ?? 'unknown',
    utilization,
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
      : '/bin/bash';
  const args = process.platform === 'win32' ? ['-Command', command] : ['-lc', command];

  try {
    const { stdout, stderr } = await execFileAsync(shell, args, {
      cwd,
      timeout: 120000,
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

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessionStore = new SessionStore();
  const configManager = new ConfigManager();
  const usageTracker = new UsageTracker();
  const workspaceStore = new WorkspaceStore();
  const registeredChannels = [
    'agents:detect',
    'agents:check-auth',
    'agents:list-models',
    'task:spawn',
    'task:stop',
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
    'usage:get',
    'usage:rate-limits',
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
    'workspace:stop',
    'workspace:delete',
    'workspace:merge',
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
  ];
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel);
  }

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
    mainWindow.webContents.send('workspace:status', { workspaceId, status });
  };

  const resolveQualityGateCommands = async (cwd: string): Promise<string[]> => {
    const configured = configManager.get().qualityGateCommands
      .map((command) => command.trim())
      .filter(Boolean);
    if (configured.length > 0) return configured;
    if (sshHost) return [];

    const packageJsonPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      if (parsed.scripts?.typecheck) return ['npm run typecheck'];
      if (parsed.scripts?.lint) return ['npm run lint'];
    } catch {
      // Fall through to no-op
    }

    return [];
  };

  const emitQualityGateMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    mainWindow.webContents.send('agent:message', { taskId, message });
  };

  const emitTaskMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    mainWindow.webContents.send('agent:message', { taskId, message });
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
    mainWindow.webContents.send('workspace:checkpoint', { workspaceId, checkpoint });
  };

  const spawnTaskRun = async (options: SpawnOptions & { agentId?: string }) => {
    requireFields(options as unknown as Record<string, unknown>, 'taskId', 'prompt', 'cwd');
    const agentId = (options.agentId ?? 'claude-code') as AgentId;
    const workspace = workspaceStore.get(options.taskId);
    if (activeTasks.has(options.taskId)) {
      throw new Error(`Task ${options.taskId} already has an active run`);
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

    const spawnOptions: SpawnOptions = {
      ...options,
      cwd: spawnCwd,
      remoteCwd: sshHost ? options.cwd : undefined,
      sshHost: sshHost ?? undefined,
      prompt: effectivePrompt,
      sessionId: agentId === 'claude-code' ? session.id : options.sessionId,
      resumeSessionId: agentId === 'codex'
        ? existingAgentSessionId
        : agentId === 'claude-code'
          ? claudeResumeId
          : undefined,
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
      emitWorkspaceStatus(workspace.id, 'running', { sessionId: session.id });
    }

    if (options.prompt !== '[Resuming previous session]') {
      sessionStore.addMessage(
        session.id,
        buildStoredUserMessage(options.prompt, options.images, options.attachments),
      );
    }

    activeTasks.set(options.taskId, handle);
    taskSessions.set(options.taskId, session.id);

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
      if (message.type === 'rate_limit') {
        cachedRateLimits = normalizeRateLimitInfo(message.rateLimitInfo as Record<string, any> | undefined);
      }
      sessionStore.addMessage(session.id, toStoredMessage(message));

      if (workspace) {
        if (message.type === 'permission_request') {
          emitWorkspaceStatus(workspace.id, 'waiting_approval', { sessionId: session.id });
        } else if (message.type === 'question_request') {
          emitWorkspaceStatus(workspace.id, 'waiting_input', { sessionId: session.id });
        } else if (message.type !== 'rate_limit') {
          emitWorkspaceStatus(workspace.id, 'running', { sessionId: session.id });
        }
      }

      if (message.type === 'permission_request') {
        mainWindow.webContents.send('agent:permission', {
          taskId: options.taskId,
          requestId: message.requestId,
          toolName: message.toolName ?? 'unknown',
          description: message.content,
          action: message.action,
          path: message.filePath,
        });
      }
      mainWindow.webContents.send('agent:message', { taskId: options.taskId, message });

      // Tool-execution heartbeats to prevent false "Stalled" detection
      if (message.type === 'tool_call' && message.toolCallId) {
        const heartbeatInterval = setInterval(() => {
          mainWindow.webContents.send('agent:message', {
            taskId: options.taskId,
            message: {
              type: 'status',
              role: 'system',
              statusKind: 'progress',
              content: `Running tool: ${message.toolName ?? 'unknown'}...`,
              timestamp: Date.now(),
            } satisfies AgentMessage,
          });
        }, 5_000);
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
        cleaningUp.add(options.taskId);
        try {
          let finalError = result?.error;

          for (const interval of toolHeartbeats.values()) clearInterval(interval);
          toolHeartbeats.clear();

          if (agentId === 'codex' && !detectedCodexSessionId) {
            const detectedSession = findLatestCodexSession(options.cwd, startedAt);
            if (detectedSession?.id) {
              detectedCodexSessionId = detectedSession.id;
              persistAgentSessionId(session.id, agentId, detectedSession.id);
            }
          }

          if (!finalError && options.mode === 'act') {
            const commands = await resolveQualityGateCommands(options.cwd);
            for (const command of commands) {
              const gateResult = await runShellCommand(command, options.cwd, sshHost);
              const passed = gateResult.exitCode === 0;
              const message: AgentMessage = {
                type: 'quality_gate',
                role: 'system',
                content: passed ? `Quality gate passed: ${command}` : `Quality gate failed: ${command}`,
                timestamp: Date.now(),
                command,
                exitCode: gateResult.exitCode,
                passed,
                stdout: gateResult.stdout,
                stderr: gateResult.stderr,
              };
              emitQualityGateMessage(options.taskId, session.id, message);
              if (!passed) {
                finalError = `Quality gate failed: ${command}`;
                break;
              }
            }
          }

          mainWindow.webContents.send('agent:done', { taskId: options.taskId, error: finalError });

          if (workspace) {
            const nextStatus: WorkspaceStatus = finalError ? 'error' : 'done';
            emitWorkspaceStatus(workspace.id, nextStatus, { sessionId: session.id });
            if (!finalError && options.mode === 'act') {
              await recordWorkspaceCheckpoint(workspace.id, options.prompt, session.id).catch(() => {
                // Checkpoints are best-effort
              });
            }
          }
        } finally {
          handle.removeAllListeners();
          activeTasks.delete(options.taskId);
          taskSessions.delete(options.taskId);
          cleaningUp.delete(options.taskId);
        }
      })();
    });

    return { taskId: options.taskId, session: sessionStore.get(session.id) ?? session };
  };

  // --- Task handlers ---

  ipcMain.handle('task:spawn', async (_event, options: SpawnOptions & { agentId?: string }) => {
    return spawnTaskRun(options);
  });

  ipcMain.handle('task:stop', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    if (cleaningUp.has(taskId)) return; // done handler already running
    cleaningUp.add(taskId);
    const handle = activeTasks.get(taskId);
    if (handle) {
      handle.stop();
      handle.removeAllListeners();
      activeTasks.delete(taskId);
    }
    taskSessions.delete(taskId);
    cleaningUp.delete(taskId);
    mainWindow.webContents.send('agent:done', { taskId, error: undefined });
    const workspace = workspaceStore.get(taskId);
    if (workspace) {
      emitWorkspaceStatus(workspace.id, 'done');
    }
  });

  ipcMain.handle('task:approve', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.approve(requestId);
  });

  ipcMain.handle('task:deny', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.deny(requestId);
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

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      emitTaskMessage(taskId, sessionId, buildUserMessagePayload(response));
    }

    const workspace = workspaceStore.get(taskId);
    if (workspace) {
      emitWorkspaceStatus(workspace.id, 'running', sessionId ? { sessionId } : undefined);
    }

    handle.answerQuestion(requestId, response);
  });

  ipcMain.handle('task:steer', async (_event, { taskId, prompt, images, attachments }: { taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }) => {
    const handle = activeTasks.get(taskId);
    if (!handle) {
      throw new Error(`Task ${taskId} does not have an active run`);
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

  // --- Usage handlers ---

  ipcMain.handle('usage:get', async () => {
    return usageTracker.get();
  });

  ipcMain.handle('usage:rate-limits', async () => {
    return cachedRateLimits;
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

  ipcMain.handle('git:branch', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: currentCwd });
      return stdout.trim();
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
    let shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
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
      proc = spawn(shell, ['-i'], {
        cwd: spawnCwd,
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    activeTerminals.set(id, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      mainWindow.webContents.send('terminal:data', { id, data: data.toString() });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      mainWindow.webContents.send('terminal:data', { id, data: data.toString() });
    });

    proc.on('exit', () => {
      activeTerminals.delete(id);
      mainWindow.webContents.send('terminal:exit', { id });
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

  ipcMain.handle('workspace:list', async (_event, { parentRepo }: { parentRepo: string }) => {
    if (sshHost) return [];
    return workspaceStore.list(parentRepo);
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

      const worktree = await createWorktree(parentRepo, branch);
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
    'workspace:spawn',
    async (_event, { workspaceId, prompt, mode = 'act' }: { workspaceId: string; prompt: string; mode?: SpawnOptions['mode'] }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      return spawnTaskRun({
        taskId: workspace.id,
        prompt,
        agentId: workspace.agentId,
        model: workspace.model,
        mode,
        cwd: workspace.worktreePath,
        sessionId: workspace.sessionId,
      });
    },
  );

  ipcMain.handle('workspace:stop', async (_event, { workspaceId }: { workspaceId: string }) => {
    const handle = activeTasks.get(workspaceId);
    if (handle) {
      handle.stop();
      handle.removeAllListeners();
      activeTasks.delete(workspaceId);
    }
    taskSessions.delete(workspaceId);
    emitWorkspaceStatus(workspaceId, 'done');
  });

  ipcMain.handle('workspace:delete', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const handle = activeTasks.get(workspaceId);
    if (handle) {
      handle.stop();
      handle.removeAllListeners();
      activeTasks.delete(workspaceId);
      taskSessions.delete(workspaceId);
    }

    await removeWorktree(workspace.parentRepo, workspace.worktreePath);
    workspaceStore.delete(workspaceId);
  });

  ipcMain.handle(
    'workspace:merge',
    async (
      _event,
      {
        workspaceId,
        targetBranch,
        squash,
      }: { workspaceId: string; targetBranch: string; squash?: boolean },
    ) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      emitWorkspaceStatus(workspaceId, 'merging');
      const result = await mergeWorktree(workspace.worktreePath, workspace.parentRepo, targetBranch, squash);
      emitWorkspaceStatus(workspaceId, result.success ? 'done' : 'error');
      return result;
    },
  );

  ipcMain.handle('workspace:diff-files', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return getChangedFiles(workspace.worktreePath);
  });

  ipcMain.handle(
    'workspace:file-diff',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      return getFileDiff(workspace.worktreePath, filePath);
    },
  );

  ipcMain.handle(
    'workspace:discard-file',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      await discardFile(workspace.worktreePath, filePath);
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

  // Initialize repo map if enabled
  const initialConfig = configManager.get().repoMap;
  if (initialConfig.enabled) {
    repoMapService.init(currentCwd, initialConfig).catch(() => {
      // Initialization error is non-fatal
    });
  }

  // Push status updates to renderer
  repoMapService.onStatusChange((status) => {
    mainWindow.webContents.send('repomap:status', status);
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
