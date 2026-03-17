import type { BrowserWindow } from 'electron';
import type { ChildProcess } from 'child_process';

import type { AgentHandle, AgentId, AgentMessage, SpawnOptions } from '../agents/types';
import type { StallMonitor } from '../agents/stall-monitor';
import type { SessionStore } from '../session/store';
import type { ConfigManager } from '../config/config';
import type { UsageTracker } from '../usage/tracker';
import type { LiveUsageService } from '../usage/live';
import type { WorkspaceStore } from '../worktree/store';
import type { WorkspaceLifecycleManager } from '../worktree/lifecycle';
import type { WorkspaceOperationManager } from '../worktree/operation-manager';
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
  mergeContext?: {
    targetBranch: string;
    squash: boolean;
  };
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

  // Workspace lifecycle (single owner of status/outcome mutations)
  lifecycleManager: WorkspaceLifecycleManager;
  operationManager: WorkspaceOperationManager;

  // Shared state maps
  activeTasks: Map<string, AgentHandle>;
  taskSessions: Map<string, string>;
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
}

/**
 * Full context including `spawnTaskRun` and `releaseTask`, available after
 * task-handlers have been registered.
 */
export interface IpcContext extends BaseIpcContext {
  spawnTaskRun: (options: SpawnTaskRunOptions) => Promise<{ taskId: string; session: any }>;
  /**
   * Canonical task cleanup function. Stops the agent process and all
   * subagents, clears timers, and removes from shared state maps.
   * Does NOT touch lifecycle manager state — callers handle that.
   * Idempotent: safe to call multiple times for the same taskId.
   */
  releaseTask: (taskId: string) => void;
}
