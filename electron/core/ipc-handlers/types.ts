import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';

import type { AgentHandle, AgentId, AgentMessage, SpawnOptions } from '../agents/types';
import type { StallMonitor } from '../agents/stall-monitor';
import type { SessionStore } from '../session/store';
import type { ConfigManager } from '../config/config';
import type { UsageTracker } from '../usage/tracker';
import type { LiveUsageService } from '../usage/live';
import type { WorkspaceStore } from '../worktree/store';
import type { WorkspaceOutcome, WorkspaceStatus } from '../worktree/types';
import type { RateLimitInfo } from './utils';

export interface SubagentEntry {
  parentTaskId: string;
  handle: AgentHandle;
  name: string;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  sessionId: string;
}

export type SpawnTaskRunOptions = SpawnOptions & {
  agentId?: string;
  autoApprovePermissions?: boolean;
  workspaceAction?: 'merge';
};

/**
 * Base context shared across all IPC handler modules.
 * Contains services, state maps, and helper functions but
 * not `spawnTaskRun` (which is defined by task-handlers).
 */
export interface BaseIpcContext {
  // Electron
  mainWindow: BrowserWindow;

  // Services
  sessionStore: SessionStore;
  configManager: ConfigManager;
  usageTracker: UsageTracker;
  liveUsageService: LiveUsageService;
  workspaceStore: WorkspaceStore;

  // Shared state maps
  activeTasks: Map<string, AgentHandle>;
  taskSessions: Map<string, string>;
  taskWorkspaceMap: Map<string, string>;
  taskWorkspaceStatusMap: Map<string, WorkspaceStatus>;
  cleaningUp: Set<string>;
  taskIdleHeartbeats: Map<string, NodeJS.Timeout>;
  activeTerminals: Map<string, ChildProcess>;
  taskStallMonitors: Map<string, StallMonitor>;
  taskRetryCounts: Map<string, number>;
  activeSubagents: Map<string, SubagentEntry>;
  cachedRateLimits: Map<string, RateLimitInfo>;

  // Mutable connection state
  getCurrentCwd: () => string;
  setCurrentCwd: (cwd: string) => void;
  getLocalCwd: () => string;
  setLocalCwd: (cwd: string) => void;
  getSshHost: () => string | null;
  setSshHost: (host: string | null) => void;

  // Renderer communication
  sendToRenderer: (channel: string, payload: unknown) => boolean;

  // Workspace helpers
  emitWorkspaceStatus: (workspaceId: string, status: WorkspaceStatus, extra?: { sessionId?: string }) => void;
  emitWorkspaceOutcome: (workspaceId: string, outcome: WorkspaceOutcome) => void;
  updateWorkspaceTaskStatus: (taskId: string, workspaceId: string, status: WorkspaceStatus, extra?: { sessionId?: string }) => void;
  releaseWorkspaceTask: (taskId: string, fallbackStatus?: WorkspaceStatus) => string | undefined;
}

/**
 * Full context including `spawnTaskRun`, available after
 * task-handlers have been registered.
 */
export interface IpcContext extends BaseIpcContext {
  spawnTaskRun: (options: SpawnTaskRunOptions) => Promise<{ taskId: string; session: any }>;
}
