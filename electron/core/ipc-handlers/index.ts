import fs from 'fs';
import os from 'os';
import path from 'path';
import { ipcMain, BrowserWindow, app } from 'electron';
import type { ChildProcess } from 'child_process';

import { agentManager } from '../agents/manager';
import type { AgentHandle, AgentId, AgentMessage } from '../agents/types';
import { logDiagnostic } from '../diagnostics/logger';
import { SessionStore } from '../session/store';
import { ConfigManager } from '../config/config';
import { UsageTracker } from '../usage/tracker';
import { LiveUsageService } from '../usage/live';
import { WorkspaceStore } from '../worktree/store';
import { WorkspaceLifecycleManager } from '../worktree/lifecycle';
import { WorkspaceOperationManager } from '../worktree/operation-manager';
import { repoMapService } from '../intelligence/repomap';
import { detectEnvironment } from '../process-utils';
import { StallMonitor } from '../agents/stall-monitor';
import type { BaseIpcContext, SubagentEntry } from './types';
import {
  type RateLimitInfo,
  requireFields,
  toRemoteShellPath,
  expandLocalHomePath,
  toAbsoluteFilePath,
  captureGitDiff,
} from './utils';
import { registerAuxiliaryIpcHandlers } from './auxiliary';
import { registerTaskHandlers } from './task-handlers';
import { registerWorkspaceHandlers } from './workspace-handlers';
import { registerProjectGroupHandlers } from './project-group-handlers';
import { registerWorkspaceGroupHandlers } from './workspace-group-handlers';
import { ProjectGroupStore } from '../project-group/store';
import { WorkspaceGroupStore } from '../workspace-group/store';
import { ContextWatcher } from '../context/watcher';
import { ContextRequestDispatcher } from '../context/request-dispatcher';
import { RemoteEventBus } from '../remote/event-bus';
import { RemoteAuthService } from '../remote/auth-service';
import { RemoteControlService } from '../remote/control-service';
import { MdnsAdvertiser } from '../remote/mdns';
import { PROTOCOL_VERSION, REMOTE_SERVER_PORT, RemoteControlServer } from '../remote/server';

console.log('[ipc-handlers] module loaded');

const activeTasks = new Map<string, AgentHandle>();
const taskSessions = new Map<string, string>();
const cleaningUp = new Set<string>();
const taskIdleHeartbeats = new Map<string, NodeJS.Timeout>();
const activeTerminals = new Map<string, ChildProcess>();
const taskStallMonitors = new Map<string, StallMonitor>();
const taskRetryCounts = new Map<string, number>();
const activeSubagents = new Map<string, SubagentEntry>();
const cachedRateLimits = new Map<string, RateLimitInfo>();

const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const USAGE_POLL_MAX_INTERVAL_MS = 60 * 60 * 1000; // 1 hour max backoff
const USAGE_POLL_INITIAL_DELAY_MS = 15 * 1000;  // 15s after startup
let usagePollTimer: NodeJS.Timeout | null = null;
let usagePollCurrentInterval = USAGE_POLL_INTERVAL_MS;
let remoteServer: RemoteControlServer | null = null;
let remoteMdns: MdnsAdvertiser | null = null;
let remoteAuthService: RemoteAuthService | null = null;

const TRACKED_RENDERER_EVENT_CHANNELS = new Set([
  'workspace:created',
  'workspace:deleted',
  'workspace:operation',
  'workspace:completion',
  'workspace:run-exit',
  'config:changed',
  'usage:live-update',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function safePreview(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (!json || json === '{}' || json === '[]' || json === 'null') return undefined;
    return truncate(json);
  } catch {
    return undefined;
  }
}

function extractActivityContext(payload: unknown): {
  taskId?: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
} {
  if (!isRecord(payload)) return {};
  const workspace = isRecord(payload.workspace) ? payload.workspace : undefined;
  return {
    ...(getString(payload.taskId) ? { taskId: getString(payload.taskId) } : {}),
    ...(getString(payload.workspaceId) ? { workspaceId: getString(payload.workspaceId) } : {}),
    ...(workspace && getString(workspace.id) ? { workspaceId: getString(workspace.id) } : {}),
    ...(getString(payload.sessionId) ? { sessionId: getString(payload.sessionId) } : {}),
    ...(getString(payload.terminalId) ? { terminalId: getString(payload.terminalId) } : {}),
  };
}

function buildRendererActivitySummary(channel: string, payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (channel === 'workspace:completion' && getString(payload.suggestedMergeTarget)) {
    return `merge to ${payload.suggestedMergeTarget}`;
  }
  if (channel === 'workspace:created' && isRecord(payload.workspace) && getString(payload.workspace.name)) {
    return truncate(payload.workspace.name as string, 80);
  }
  if (channel === 'workspace:run-exit' && typeof payload.exitCode === 'number') {
    return `exit ${payload.exitCode}`;
  }
  return undefined;
}

function buildRendererActivity(channel: string, payload: unknown) {
  const preview = safePreview(payload);
  const summary = buildRendererActivitySummary(channel, payload);
  return {
    id: `ipc:${channel}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    channel,
    phase: 'event',
    direction: 'main->renderer',
    timestamp: Date.now(),
    ...extractActivityContext(payload),
    ...(summary ? { summary } : {}),
    ...(preview ? { payloadPreview: preview } : {}),
  };
}

let currentCwd = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
let localCwd = currentCwd;
let sshHost: string | null = null;

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessionStore = new SessionStore();
  const configManager = new ConfigManager();
  const usageTracker = new UsageTracker();
  const liveUsageService = new LiveUsageService();
  const workspaceStore = new WorkspaceStore();
  const workspaceGroupStore = new WorkspaceGroupStore();
  const remoteEventBus = new RemoteEventBus();

  const sendToRenderer = (channel: string, payload: unknown): boolean => {
    remoteEventBus.publish(channel, payload);
    const windowClosed = typeof (mainWindow as BrowserWindow & { isDestroyed?: () => boolean }).isDestroyed === 'function'
      && (mainWindow as BrowserWindow & { isDestroyed: () => boolean }).isDestroyed();
    const webContentsClosed = typeof (mainWindow.webContents as typeof mainWindow.webContents & { isDestroyed?: () => boolean }).isDestroyed === 'function'
      && (mainWindow.webContents as typeof mainWindow.webContents & { isDestroyed: () => boolean }).isDestroyed();

    if (windowClosed || webContentsClosed) {
      return false;
    }

    try {
      mainWindow.webContents.send(channel, payload);
      if (channel !== 'ipc:activity' && TRACKED_RENDERER_EVENT_CHANNELS.has(channel)) {
        mainWindow.webContents.send('ipc:activity', buildRendererActivity(channel, payload));
      }
      return true;
    } catch (error) {
      console.warn(`[ipc-handlers] Failed to send ${channel}`, error);
      return false;
    }
  };

  // Centralized lifecycle manager — single owner of workspace status/outcome
  const lifecycleManager = new WorkspaceLifecycleManager(workspaceStore, sendToRenderer);
  const operationManager = new WorkspaceOperationManager(sendToRenderer);

  // Remove previously registered handlers to allow hot-reload
  const registeredChannels = [
    'env:detect',
    'agents:detect',
    'agents:check-auth',
    'agents:list-models',
    'agents:active-tasks',
    'task:spawn',
    'task:stop',
    'task:restart',
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
    'sessions:rename',
    'sessions:export',
    'session:summary',
    'config:get',
    'config:set',
    'config:reset',
    'config:export',
    'config:import',
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
    'git:upstream',
    'git:is-repo',
    'git:status',
    'git:log',
    'git:diff-stat',
    'fs:readdir',
    'fs:read',
    'fs:write',
    'fs:stat',
    'fs:grep',
    'fs:glob',
    'fs:listdirs',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:kill',
    'terminal:ack',
    'terminal:get-profiles',
    'terminal:list',
    'ssh:test',
    'ssh:connect',
    'ssh:disconnect',
    'workspace:list',
    'workspace:get',
    'workspace:create',
    'workspace:create-quick',
    'workspace:rename-branch',
    'workspace:spawn',
    'workspace:spawn-chat',
    'workspace:list-chats',
    'workspace:stop',
    'workspace:delete',
    'workspace:set-outcome',
    'workspace:sync-outcomes',
    'workspace:update',
    'workspace:archive',
    'workspace:unarchive',
    'workspace:open-ide',
    'workspace:diff-files',
    'workspace:diff-files-separated',
    'workspace:file-diff',
    'workspace:discard-file',
    'workspace:discard-all',
    'workspace:full-diff',
    'workspace:git-state',
    'workspace:active-task',
    'workspace:list-operations',
    'workspace:cancel-operation',
    'workspace-group:create',
    'workspace-group:get',
    'workspace-group:list-members',
    'workspace-group:add-member',
    'workspace-group:remove-member',
    'workspace-group:delete',
    'checkpoint:list',
    'checkpoint:diff',
    'checkpoint:revert',
    'repomap:get-config',
    'repomap:set-config',
    'repomap:get-status',
    'repomap:rebuild',
    'repomap:preview',
    'diff:get',
    'shell:exec',
    'completion:suggest',
    'completion:providers',
    'mcp:status',
    'mcp:reconnect',
    'mcp:toggle',
    'diagnostics:logs',
    'diagnostics:log-path',
    'project-group:create',
    'project-group:list',
    'project-group:get',
    'project-group:add-project',
    'project-group:remove-project',
    'project-group:rename',
    'project-group:delete',
    'workspace:list-multi',
    'workspace:run-command',
    'workspace:detect-scripts',
    'workspace:stop-run',
    'workspace:merge',
    'workspace:merge-preview',
    'workspace:create-pr',
    'workspace:disk-usage',
    'workspace:prune-stale',
    'remote:status',
    'remote:create-pairing-code',
    'remote:active-pairing-code',
    'remote:list-clients',
    'remote:revoke-client',
  ];
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel);
  }

  // Fullscreen events
  const emitFullscreenChanged = () => {
    sendToRenderer('window:fullscreen-changed', { isFullscreen: mainWindow.isFullScreen() });
  };
  mainWindow.on('enter-full-screen', emitFullscreenChanged);
  mainWindow.on('leave-full-screen', emitFullscreenChanged);

  // Build the shared context object
  const baseCtx: BaseIpcContext = {
    mainWindow,
    sessionStore,
    configManager,
    usageTracker,
    liveUsageService,
    workspaceStore,
    lifecycleManager,
    operationManager,
    activeTasks,
    taskSessions,
    cleaningUp,
    taskIdleHeartbeats,
    activeTerminals,
    taskStallMonitors,
    taskRetryCounts,
    activeSubagents,
    cachedRateLimits,
    getCurrentCwd: () => currentCwd,
    setCurrentCwd: (cwd) => { currentCwd = cwd; },
    getLocalCwd: () => localCwd,
    setLocalCwd: (cwd) => { localCwd = cwd; },
    getSshHost: () => sshHost,
    setSshHost: (host) => { sshHost = host; },
    sendToRenderer,
  };

  // --- Environment & agent detection ---

  ipcMain.handle('env:detect', async () => {
    return detectEnvironment();
  });

  ipcMain.handle('agents:detect', async () => {
    return agentManager.detectAll();
  });

  ipcMain.handle('agents:check-auth', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.checkAuth(agentId);
  });

  ipcMain.handle('agents:list-models', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.listModels(agentId as AgentId);
  });

  // --- Register handler modules ---

  const { spawnTaskRun, releaseTask } = registerTaskHandlers(baseCtx);

  // Build the full context (with spawnTaskRun + releaseTask) for modules that need it
  const fullCtx = { ...baseCtx, spawnTaskRun, releaseTask };
  const remoteControlService = new RemoteControlService(fullCtx);
  remoteAuthService = new RemoteAuthService();

  registerAuxiliaryIpcHandlers({
    mainWindow,
    sessionStore,
    configManager,
    usageTracker,
    liveUsageService,
    workspaceStore,
    sendToRenderer,
    lifecycleManager,
    activeTasks,
    activeTerminals,
    cachedRateLimits,
    getCurrentCwd: () => currentCwd,
    setCurrentCwd: (cwd) => { currentCwd = cwd; },
    getLocalCwd: () => localCwd,
    setLocalCwd: (cwd) => { localCwd = cwd; },
    getSshHost: () => sshHost,
    setSshHost: (host) => { sshHost = host; },
    requireFields,
    toRemoteShellPath,
    expandLocalHomePath,
    toAbsoluteFilePath,
    captureGitDiff,
  });

  registerWorkspaceHandlers(fullCtx);

  remoteServer?.stop();
  remoteMdns?.stop();
  remoteServer = new RemoteControlServer({
    authService: remoteAuthService,
    controlService: remoteControlService,
    eventBus: remoteEventBus,
  });
  remoteMdns = new MdnsAdvertiser();
  try {
    remoteServer.start();
    remoteMdns.start(REMOTE_SERVER_PORT, PROTOCOL_VERSION);
  } catch (error) {
    logDiagnostic('remote-server', 'startup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  ipcMain.handle('remote:status', async () => {
    return remoteServer?.getStatus(remoteMdns?.isAdvertised() ?? false) ?? {
      enabled: false,
      version: PROTOCOL_VERSION,
      port: REMOTE_SERVER_PORT,
      hostname: os.hostname(),
      advertised: false,
      connectionCount: 0,
      pairedClientCount: remoteAuthService?.countActiveClients() ?? 0,
      networkAddresses: [],
    };
  });

  ipcMain.handle('remote:create-pairing-code', async () => {
    if (!remoteAuthService) {
      throw new Error('Remote auth service is not available');
    }
    return remoteAuthService.createPairingCode();
  });

  ipcMain.handle('remote:active-pairing-code', async () => {
    return remoteAuthService?.getActivePairingCode() ?? null;
  });

  ipcMain.handle('remote:list-clients', async () => {
    return remoteAuthService?.listClients() ?? [];
  });

  ipcMain.handle('remote:revoke-client', async (_event, { clientId }: { clientId: string }) => {
    requireFields({ clientId }, 'clientId');
    remoteAuthService?.revokeClient(clientId);
  });

  // Support `.context/requests/*.json` terminal actions even when no agent task
  // is active, so external agents can open visible terminals in the Flux UI.
  let globalContextWatcher: ContextWatcher | null = null;
  let globalRequestDispatcher: ContextRequestDispatcher | null = null;
  const contextRoot = process.cwd();
  if (fs.existsSync(path.join(contextRoot, '.context'))) {
    globalRequestDispatcher = new ContextRequestDispatcher({
      cwd: contextRoot,
      onSpawnVisibleTerminal: (req) => {
        sendToRenderer('terminal:agent-create', {
          id: req.id,
          command: req.command,
          cwd: req.cwd,
        });
      },
      onKillVisibleTerminal: (terminalId) => {
        sendToRenderer('terminal:agent-kill', { id: terminalId });
      },
    });

    globalContextWatcher = new ContextWatcher({
      cwd: contextRoot,
      onStateChange: () => {},
      shouldProcessRequest: (request) => activeTasks.size === 0 && request.action.startsWith('terminal:'),
      onRequest: (request) => {
        void globalRequestDispatcher!.dispatch(request).then((result) => {
          globalContextWatcher?.writeResponse(request.id, result.ok, result.data, result.error);
        });
      },
    });
    globalContextWatcher.start();
  }

  // Self-heal workspace state before renderer connects.
  // Fire-and-forget but log errors — must not block handler registration.
  lifecycleManager.reconcileOnStartup().catch(err => {
    console.error('[lifecycle] Startup reconciliation failed:', err);
  });

  const projectGroupStore = new ProjectGroupStore();
  registerProjectGroupHandlers({ projectGroupStore, workspaceStore });
  registerWorkspaceGroupHandlers({ workspaceGroupStore });

  app.once('before-quit', () => {
    globalContextWatcher?.stop();
    globalRequestDispatcher?.dispose();
    operationManager.cancelAll();
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

  // Start background usage poller — independent of any agent or chat activity.
  // Fires once after a short delay, then every 15 minutes (backs off on errors).
  usagePollCurrentInterval = USAGE_POLL_INTERVAL_MS;
  function schedulePoll(delayMs: number): void {
    usagePollTimer = setTimeout(async () => {
      try {
        const cached = Array.from(cachedRateLimits.values());
        logDiagnostic('usage', 'usage-poller: poll start', {
          cachedCount: cached.length,
          cachedKeys: cached.map((r) => `${r.providerId}:${r.rateLimitType}`),
        });
        const result = await liveUsageService.getOverview(cached);
        logDiagnostic('usage', 'usage-poller: poll complete', {
          providerCount: result.providers.length,
          providers: result.providers.map((p) => ({
            providerId: p.providerId,
            status: p.status,
            source: p.source,
            windowCount: p.windows.length,
          })),
        });
        sendToRenderer('usage:live-update', result);
        // Reset to normal interval on success
        usagePollCurrentInterval = USAGE_POLL_INTERVAL_MS;
      } catch (err) {
        console.warn('[usage-poller] fetch failed:', err instanceof Error ? err.message : String(err));
        // Back off: double the interval on failure, capped at max
        usagePollCurrentInterval = Math.min(usagePollCurrentInterval * 2, USAGE_POLL_MAX_INTERVAL_MS);
        logDiagnostic('usage', 'usage-poller: backing off', { nextIntervalMs: usagePollCurrentInterval });
      }
      const jitter = Math.floor(Math.random() * 60_000); // 0-60s jitter
      schedulePoll(usagePollCurrentInterval + jitter);
    }, delayMs);
  }
  schedulePoll(USAGE_POLL_INITIAL_DELAY_MS);
}

export function cleanupProcesses(): void {
  remoteServer?.stop();
  remoteServer = null;
  remoteMdns?.stop();
  remoteMdns = null;

  // Stop background usage poller
  if (usagePollTimer) {
    clearTimeout(usagePollTimer);
    usagePollTimer = null;
  }

  // Dispose stall monitors to prevent stale callbacks during shutdown
  for (const [, monitor] of taskStallMonitors) {
    try { monitor.dispose(); } catch {}
  }
  taskStallMonitors.clear();

  // Clear idle heartbeat intervals
  for (const [, interval] of taskIdleHeartbeats) {
    try { clearInterval(interval); } catch {}
  }
  taskIdleHeartbeats.clear();

  // Kill terminal processes
  for (const [, proc] of activeTerminals) {
    try { proc.kill(); } catch {}
  }
  activeTerminals.clear();

  // Stop agent handles
  for (const [, handle] of activeTasks) {
    try { handle.stop(); } catch {}
  }
  activeTasks.clear();

  // Clear remaining state maps
  taskSessions.clear();
  cleaningUp.clear();
  taskRetryCounts.clear();
}
