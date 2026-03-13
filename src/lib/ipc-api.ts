import type { DetectedAgent, AuthResult, AgentMessage, DiffData, SpawnOptions, TaskMode, ThinkingLevel, FileAttachment } from './types';

export type RuntimeEnvironment = 'local' | 'ssh' | 'wsl';

export interface EnvironmentInfo {
  runtime: RuntimeEnvironment;
  platform: string;
  wslDistro: string | null;
  isSSHSession: boolean;
  isWSL: boolean;
}

// Channels the renderer can invoke on main
export interface IpcChannels {
  'env:detect': { args: []; result: EnvironmentInfo };
  'agents:detect': { args: []; result: DetectedAgent[] };
  'agents:check-auth': { args: [{ agentId: string }]; result: AuthResult };
  'task:spawn': { args: [SpawnOptions & { agentId?: string }]; result: { taskId: string; session: Session } };
  'task:stop': { args: [{ taskId: string }]; result: void };
  'subagent:spawn': {
    args: [{ parentTaskId: string; prompt: string; model?: string; name: string; cwd?: string }];
    result: { subagentId: string };
  };
  'subagent:stop': { args: [{ subagentId?: string; parentTaskId?: string }]; result: void };
  'task:approve': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:deny': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:answer-question': { args: [{ taskId: string; requestId: string; response: string }]; result: void };
  'task:steer': { args: [{ taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }]; result: void };
  'sessions:list': { args: []; result: Session[] };
  'sessions:get': { args: [{ id: string }]; result: Session | null };
  'sessions:delete': { args: [{ id: string }]; result: void };
  'sessions:messages': { args: [{ id: string }]; result: SessionMessage[] };
  'config:get': { args: []; result: FluxConfig };
  'config:set': { args: [Partial<FluxConfig>]; result: void };
  'usage:get': { args: []; result: UsageInfo };
  'usage:rate-limits': { args: []; result: RateLimitInfo[] };
  'usage:live': { args: []; result: LiveUsageOverview };
  'cwd:get': { args: []; result: string };
  'cwd:set': { args: [{ cwd: string }]; result: string };
  'cwd:pick': { args: []; result: string | null };
  'git:branch': { args: []; result: string | null };
  'git:status': { args: []; result: { dirty: boolean; files: string } };
  'fs:readdir': { args: [{ dirPath?: string; depth?: number }]; result: Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }> };
  'fs:read': { args: [{ filePath: string }]; result: { content: string | null; error: string | null } };
  'fs:listdirs': { args: [{ dirPath: string }]; result: { path: string; entries: Array<{ name: string; isDirectory: boolean }>; error: string | null } };
  'fs:grep': { args: [{ pattern: string; cwd: string }]; result: Array<{ file: string; line: number; text: string }> };
  'terminal:create': { args: [{ id: string; cwd?: string }]; result: { id: string } };
  'terminal:write': { args: [{ id: string; data: string }]; result: void };
  'terminal:resize': { args: [{ id: string; cols: number; rows: number }]; result: void };
  'terminal:kill': { args: [{ id: string }]; result: void };
  'ssh:test': { args: [{ host: string }]; result: { success: boolean; error: string | null } };
  'ssh:connect': { args: [{ host: string; remoteCwd?: string }]; result: { connected: boolean } };
  'ssh:disconnect': { args: []; result: { connected: boolean; cwd: string } };
  'workspace:list': { args: [{ parentRepo: string }]; result: Workspace[] };
  'workspace:create': {
    args: [{ name: string; parentRepo: string; branch: string; agentId: string; model: string }];
    result: Workspace;
  };
  'workspace:spawn': { args: [{ workspaceId: string; prompt: string; mode?: TaskMode }]; result: { taskId: string; session: Session } };
  'workspace:stop': { args: [{ workspaceId: string }]; result: void };
  'workspace:delete': { args: [{ workspaceId: string }]; result: void };
  'workspace:merge': {
    args: [{ workspaceId: string; targetBranch: string; squash?: boolean }];
    result: MergeResult;
  };
  'workspace:diff-files': { args: [{ workspaceId: string }]; result: DiffFile[] };
  'workspace:file-diff': {
    args: [{ workspaceId: string; filePath: string }];
    result: { oldContent: string; newContent: string; unified: string };
  };
  'workspace:discard-file': { args: [{ workspaceId: string; filePath: string }]; result: void };
  'checkpoint:list': { args: [{ workspaceId: string }]; result: Checkpoint[] };
  'checkpoint:diff': { args: [{ checkpointId: string; workspaceId: string }]; result: string };
  'checkpoint:revert': { args: [{ checkpointId: string; workspaceId: string }]; result: void };
  'repomap:get-config': { args: []; result: RepoMapIpcConfig };
  'repomap:set-config': { args: [RepoMapIpcConfig]; result: void };
  'repomap:get-status': { args: []; result: RepoMapIpcStatus };
  'repomap:rebuild': { args: []; result: void };
  'repomap:preview': { args: [{ prompt: string }]; result: string };
  'diff:get': { args: [{ taskId: string; sessionId: string }]; result: DiffData | null };
}

// Events main sends to renderer
export interface IpcEvents {
  'agent:message': { taskId: string; message: AgentMessage };
  'agent:done': { taskId: string; error?: string };
  'agent:diff': { taskId: string; key: string; diff: DiffData };
  'agent:permission': { taskId: string; requestId: string; toolName: string; description: string; action?: string; path?: string };
  'workspace:status': { workspaceId: string; status: WorkspaceStatus };
  'workspace:checkpoint': { workspaceId: string; checkpoint: Checkpoint };
  'repomap:status': RepoMapIpcStatus;
}

export interface RepoMapIpcConfig {
  enabled: boolean;
  maxTokens: number;
  indexedFilePatterns: string[];
  excludePatterns: string[];
  perAgentEnabled: Record<string, boolean>;
  autoRefresh: boolean;
}

export interface RepoMapIpcStatus {
  state: 'idle' | 'building' | 'ready' | 'error';
  totalFiles: number;
  parsedFiles: number;
  totalTags: number;
  lastBuiltAt: number | null;
  errorMessage?: string;
}

export interface SessionSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  messageCount: number;
  lastMessagePreview: string | null;
}

export interface Session {
  id: string;
  title: string;
  agentId: string;
  model: string;
  mode: TaskMode;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
  summary?: SessionSummary;
}

export interface SessionMessage {
  id: number;
  sessionId: string;
  role: string;
  type: string;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  toolCallId: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  payloadJson: string | null;
  timestamp: number;
}

export interface FluxConfig {
  theme: 'dark' | 'light';
  fontSize: number;
  sendKey: 'cmd+enter' | 'enter';
  defaultAgent: string;
  defaultModel: string;
  subagentModel?: string;
  defaultThinking: ThinkingLevel;
  defaultMode: TaskMode;
  qualityGateCommands: string[];
  customAgentPaths: Record<string, string>;
  recentProjects: Array<{
    path: string;
    name: string;
    lastOpened: number;
    isSSH?: boolean;
    sshHost?: string;
  }>;
  recentSshHosts: Array<{
    host: string;
    remotePath: string;
    lastUsed: number;
  }>;
  repoMap: RepoMapIpcConfig;
}

export interface Checkpoint {
  id: string;
  workspaceId: string;
  sessionId: string;
  messageIndex: number;
  gitCommitSha: string;
  parentSha: string;
  description: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: number;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface Workspace {
  id: string;
  name: string;
  parentRepo: string;
  branch: string;
  status: WorkspaceStatus;
  createdAt: number;
  updatedAt: number;
  agentId: string;
  model: string;
  worktreePath: string;
  sessionId?: string;
}

export type WorkspaceStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error' | 'merging';

export interface MergeResult {
  success: boolean;
  error?: string;
  conflicts?: string[];
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

export interface LiveUsageWindow {
  providerId: 'claude-code' | 'codex';
  providerLabel: string;
  windowKey: 'five_hour' | 'seven_day';
  windowLabel: string;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  usedPercent: number;
  resetsAt: number | null;
  remainingMs: number | null;
  fetchedAt: number;
  source: 'live' | 'stream_fallback' | 'snapshot';
  isStale: boolean;
  usedValue: number | null;
  limitValue: number | null;
  remainingValue: number | null;
  unit: string | null;
}

export interface LiveUsageProvider {
  providerId: 'claude-code' | 'codex';
  label: string;
  status: 'connected' | 'auth_missing' | 'error';
  fetchedAt: number | null;
  source: 'live' | 'stream_fallback' | 'snapshot' | null;
  message: string | null;
  windows: LiveUsageWindow[];
}

export interface UsageHistoryPoint {
  providerId: 'claude-code' | 'codex';
  windowKey: 'five_hour' | 'seven_day';
  sampledAt: number;
  usedPercent: number;
  resetsAt: number | null;
  source: 'live' | 'stream_fallback' | 'snapshot';
}

export interface LiveUsageOverview {
  providers: LiveUsageProvider[];
  history: UsageHistoryPoint[];
  updatedAt: number;
}

export interface UsageInfo {
  summary: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  };
  providers: Array<{
    agentId: string;
    label: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
    lastUsedAt: number | null;
    shareOfRequests: number;
    reportedCostAvailable: boolean;
  }>;
  daily: Array<{
    date: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  }>;
  windowDays: number;
  updatedAt: number;
}
