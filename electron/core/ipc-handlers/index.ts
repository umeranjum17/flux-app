import { ipcMain, BrowserWindow, app } from 'electron';
import type { ChildProcess } from 'child_process';

import { agentManager } from '../agents/manager';
import type { AgentHandle, AgentId, AgentMessage } from '../agents/types';
import { SessionStore } from '../session/store';
import { ConfigManager } from '../config/config';
import { UsageTracker } from '../usage/tracker';
import { LiveUsageService } from '../usage/live';
import { WorkspaceStore } from '../worktree/store';
import { WorkspaceLifecycleManager } from '../worktree/lifecycle';
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
import { ProjectGroupStore } from '../project-group/store';

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

let currentCwd = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
let localCwd = currentCwd;
let sshHost: string | null = null;

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

  // Centralized lifecycle manager — single owner of workspace status/outcome
  const lifecycleManager = new WorkspaceLifecycleManager(workspaceStore, sendToRenderer);

  // Remove previously registered handlers to allow hot-reload
  const registeredChannels = [
    'env:detect',
    'agents:detect',
    'agents:check-auth',
    'agents:list-models',
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
    'git:upstream',
    'git:is-repo',
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
    'diff:get',
    'shell:exec',
    'completion:suggest',
    'completion:providers',
    'mcp:status',
    'mcp:reconnect',
    'mcp:toggle',
    'project-group:create',
    'project-group:list',
    'project-group:get',
    'project-group:add-project',
    'project-group:remove-project',
    'project-group:rename',
    'project-group:delete',
    'workspace:list-multi',
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

  const projectGroupStore = new ProjectGroupStore();
  registerProjectGroupHandlers({ projectGroupStore, workspaceStore });

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
