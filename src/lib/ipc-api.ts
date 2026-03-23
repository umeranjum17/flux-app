import type { DetectedAgent, AuthResult, AgentMessage, DiffData, SpawnOptions, TaskMode, ThinkingLevel, FileAttachment, TodoItem, ProjectGroup } from './types';

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
  'task:spawn': {
    args: [SpawnOptions & {
      agentId?: string;
      autoApprovePermissions?: boolean;
      workspaceAction?: 'merge';
      mergeContext?: {
        targetBranch: string;
        squash: boolean;
      };
    }];
    result: { taskId: string; session: Session };
  };
  'task:stop': { args: [{ taskId: string }]; result: void };
  'task:restart': {
    args: [{
      taskId: string;
      agentId?: string;
      model?: string;
      mode?: TaskMode;
      thinking?: ThinkingLevel;
      cwd?: string;
    }];
    result: { taskId: string; session: Session };
  };
  'subagent:spawn': {
    args: [{ parentTaskId: string; prompt: string; model?: string; name: string; cwd?: string }];
    result: { subagentId: string };
  };
  'subagent:stop': { args: [{ subagentId?: string; parentTaskId?: string }]; result: void };
  'task:approve': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:deny': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:answer-question': { args: [{ taskId: string; requestId: string; response: string }]; result: void };
  'task:steer': { args: [{ taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }]; result: { steerFailed?: boolean; reason?: string } };
  'sessions:list': { args: []; result: Session[] };
  'sessions:get': { args: [{ id: string }]; result: Session | null };
  'sessions:delete': { args: [{ id: string }]; result: void };
  'sessions:messages': { args: [{ id: string }]; result: SessionMessage[] };
  'config:get': { args: []; result: FluxConfig };
  'config:set': { args: [Partial<FluxConfig>]; result: void };
  'theme:update-titlebar': { args: [{ theme: 'dark' | 'light' }]; result: void };
  'window:is-fullscreen': { args: []; result: boolean };
  'zoom:set': { args: [{ level: number }]; result: void };
  'zoom:get': { args: []; result: number };
  'usage:get': { args: []; result: UsageInfo };
  'usage:rate-limits': { args: []; result: RateLimitInfo[] };
  'usage:live': { args: []; result: LiveUsageOverview };
  'cwd:get': { args: []; result: string };
  'cwd:set': { args: [{ cwd: string }]; result: string };
  'cwd:pick': { args: []; result: string | null };
  'cwd:create': {
    args: [{ parentPath: string; folderName: string; initGit: boolean }];
    result: { path: string } | { error: string };
  };
  'fs:pick-directory': { args: [{ defaultPath?: string }]; result: string | null };
  'git:init': { args: [{ dirPath?: string }?]; result: { success: boolean; error?: string } };
  'git:is-repo': { args: [{ dirPath?: string }?]; result: boolean };
  'git:branch': { args: []; result: string | null };
  'git:upstream': { args: []; result: string | null };
  'git:status': { args: []; result: { dirty: boolean; files: string } };
  'git:info': { args: []; result: { isRepo: boolean; branch: string | null; upstream: string | null; dirty: boolean } };
  'fs:readdir': { args: [{ dirPath?: string; depth?: number }]; result: Array<{ name: string; path: string; isDirectory: boolean; children?: unknown[] }> };
  'fs:read': { args: [{ filePath: string }]; result: { content: string | null; error: string | null } };
  'fs:listdirs': { args: [{ dirPath: string }]; result: { path: string; entries: Array<{ name: string; isDirectory: boolean }>; error: string | null } };
  'fs:grep': { args: [{ pattern: string; cwd: string }]; result: Array<{ file: string; line: number; text: string }> };
  'fs:glob': { args: [{ cwd: string; limit?: number }]; result: Array<{ path: string; name: string }> };
  'terminal:create': { args: [{ id: string; cwd?: string; workspaceId?: string; shell?: string; command?: string }]; result: { id: string; shellName: string } };
  'terminal:write': { args: [{ id: string; data: string }]; result: void };
  'terminal:resize': { args: [{ id: string; cols: number; rows: number }]; result: void };
  'terminal:kill': { args: [{ id: string }]; result: void };
  'terminal:ack': { args: [{ id: string; charCount: number }]; result: void };
  'terminal:get-profiles': { args: []; result: Array<{ name: string; path: string; icon: string }> };
  'ssh:test': { args: [{ host: string }]; result: { success: boolean; error: string | null } };
  'ssh:listdirs': { args: [{ host: string; dirPath: string }]; result: { path: string; entries: Array<{ name: string; isDirectory: boolean }>; error: string | null } };
  'ssh:connect': { args: [{ host: string; remoteCwd?: string }]; result: { connected: boolean } };
  'ssh:disconnect': { args: []; result: { connected: boolean; cwd: string } };
  'workspace:list': { args: [{ parentRepo: string }]; result: Workspace[] };
  'workspace:create': {
    args: [{ name: string; parentRepo: string; branch: string; agentId: string; model: string; mode?: TaskMode; thinking?: ThinkingLevel; sshHost?: string }];
    result: Workspace;
  };
  'workspace:create-quick': {
    args: [{ parentRepo: string; agentId: string; model: string; mode?: TaskMode; thinking?: ThinkingLevel; sshHost?: string }];
    result: Workspace;
  };
  'workspace:create-direct': {
    args: [{ name: string; parentRepo: string; agentId: string; model: string; mode?: TaskMode; thinking?: ThinkingLevel }];
    result: Workspace;
  };
  'workspace:rename-branch': {
    args: [{ workspaceId: string; newBranch: string; newName?: string }];
    result: Workspace;
  };
  'workspace:spawn': { args: [{ taskId?: string; workspaceId: string; prompt: string; mode?: TaskMode }]; result: { taskId: string; session: Session } };
  'workspace:spawn-chat': {
    args: [{ taskId?: string; workspaceId: string; prompt: string; mode?: TaskMode; agentId?: string; model?: string; images?: string[]; attachments?: FileAttachment[] }];
    result: { taskId: string; session: Session };
  };
  'workspace:list-chats': { args: [{ workspaceId: string }]; result: WorkspaceSession[] };
  'workspace:stop': { args: [{ workspaceId: string }]; result: void };
  'workspace:delete': { args: [{ workspaceId: string }]; result: void };
  'workspace:set-outcome': {
    args: [{ workspaceId: string; outcome: WorkspaceOutcome }];
    result: void;
  };
  'workspace:sync-outcomes': {
    args: [{ parentRepo: string }];
    result: void;
  };
  'workspace:update': {
    args: [{
      workspaceId: string;
      agentId?: string;
      model?: string;
      mode?: TaskMode;
      thinking?: ThinkingLevel;
      planAgentId?: string;
      planModel?: string;
      planThinking?: ThinkingLevel;
      actAgentId?: string;
      actModel?: string;
      actThinking?: ThinkingLevel;
    }];
    result: void;
  };
  'workspace:archive': { args: [{ workspaceId: string }]; result: { operation: WorkspaceOperation } };
  'workspace:open-ide': { args: [{ workspaceId: string; ide?: 'code' | 'cursor' | 'zed' }]; result: { ide: 'code' | 'cursor' | 'zed' } };
  'workspace:diff-files': { args: [{ workspaceId: string }]; result: DiffFile[] };
  'workspace:diff-files-separated': { args: [{ workspaceId: string }]; result: WorkspaceDiffSections };
  'workspace:file-diff': {
    args: [{ workspaceId: string; filePath: string; scope?: WorkspaceDiffScope }];
    result: { oldContent: string; newContent: string; unified: string };
  };
  'workspace:discard-file': { args: [{ workspaceId: string; filePath: string; scope?: WorkspaceDiscardScope }]; result: void };
  'checkpoint:list': { args: [{ workspaceId: string }]; result: Checkpoint[] };
  'checkpoint:diff': { args: [{ checkpointId: string; workspaceId: string }]; result: string };
  'checkpoint:revert': { args: [{ checkpointId: string; workspaceId: string }]; result: void };
  'repomap:get-config': { args: []; result: RepoMapIpcConfig };
  'repomap:set-config': { args: [RepoMapIpcConfig]; result: void };
  'repomap:get-status': { args: []; result: RepoMapIpcStatus };
  'repomap:rebuild': { args: []; result: void };
  'repomap:preview': { args: [{ prompt: string }]; result: string };
  'diff:get': { args: [{ taskId: string; sessionId: string }]; result: DiffData | null };
  'shell:exec': { args: [{ command: string; cwd: string; timeout?: number }]; result: { stdout: string; stderr: string; exitCode: number; durationMs: number } };
  'completion:suggest': { args: [{ prefix: string; cwd: string; recentCommands: string[]; model?: string }]; result: { suggestion: string; error?: string } };
  'completion:providers': { args: []; result: { providers: string[] } };
  'mcp:status': { args: [{ taskId: string }]; result: McpServerStatus[] };
  'mcp:reconnect': { args: [{ taskId: string; serverName: string }]; result: void };
  'mcp:toggle': { args: [{ taskId: string; serverName: string; enabled: boolean }]; result: void };

  // Session management (extended)
  'sessions:rename': { args: [{ id: string; title: string }]; result: void };
  'sessions:export': {
    args: [{ id: string; format?: 'markdown' | 'json' }];
    result: { content: string; filename: string };
  };
  'session:summary': {
    args: [{ id: string }];
    result: SessionSummary;
  };

  // Workspace single fetch & bulk operations
  'workspace:get': { args: [{ workspaceId: string }]; result: Workspace | null };
  'workspace:discard-all': { args: [{ workspaceId: string }]; result: void };
  'workspace:full-diff': { args: [{ workspaceId: string }]; result: string };
  'workspace:git-state': {
    args: [{ workspaceId: string }];
    result: WorkspaceGitState;
  };
  'workspace:active-task': {
    args: [{ workspaceId: string }];
    result: string[];
  };
  'workspace:list-operations': { args: []; result: WorkspaceOperation[] };
  'workspace:cancel-operation': { args: [{ operationId: string }]; result: void };

  // Git extended operations
  'git:log': {
    args: [{ cwd?: string; maxCount?: number }];
    result: GitLogEntry[];
  };
  'git:diff-stat': {
    args: [{ cwd?: string }];
    result: { filesChanged: number; additions: number; deletions: number };
  };

  // Active task introspection
  'agents:active-tasks': {
    args: [];
    result: ActiveTaskInfo[];
  };

  // File system extended
  'fs:stat': {
    args: [{ filePath: string }];
    result: { size: number; modifiedMs: number; isDirectory: boolean; isFile: boolean } | null;
  };
  'fs:write': {
    args: [{ filePath: string; content: string }];
    result: { success: boolean; error?: string };
  };

  // Terminal introspection
  'terminal:list': {
    args: [];
    result: Array<{ id: string; pid: number | undefined; kind: 'pty' | 'ssh' }>;
  };

  // Diagnostics
  'diagnostics:logs': {
    args: [{ lines?: number }];
    result: string;
  };
  'diagnostics:log-path': {
    args: [];
    result: string;
  };

  // Config extended
  'config:reset': { args: []; result: void };
  'config:export': { args: []; result: string };
  'config:import': { args: [{ json: string }]; result: { success: boolean; error?: string } };

  // Workspace run commands
  'workspace:detect-scripts': {
    args: [{ workspaceId: string }];
    result: WorkspaceScript[];
  };

  // Workspace merge & PR
  'workspace:merge': {
    args: [{ workspaceId: string; targetBranch: string; squash?: boolean }];
    result: MergeResult;
  };
  'workspace:merge-preview': {
    args: [{ workspaceId: string; targetBranch: string }];
    result: MergePreview;
  };
  'workspace:create-pr': {
    args: [{ workspaceId: string; title: string; body: string; targetBranch: string; draft?: boolean }];
    result: { url: string; number: number };
  };

  // Worktree hygiene
  'workspace:disk-usage': {
    args: [{ parentRepo: string }];
    result: WorkspaceDiskUsage[];
  };
  'workspace:prune-stale': {
    args: [{ parentRepo: string; olderThanDays?: number }];
    result: { pruned: string[] };
  };

  'remote:status': { args: []; result: RemoteServerStatus };
  'remote:create-pairing-code': { args: []; result: RemotePairingCode };
  'remote:active-pairing-code': { args: []; result: RemotePairingCode | null };
  'remote:list-clients': { args: []; result: RemoteClientInfo[] };
  'remote:revoke-client': { args: [{ clientId: string }]; result: void };

  // Project groups
  'project-group:create': { args: [{ name: string; projects?: string[] }]; result: ProjectGroup };
  'project-group:list': { args: []; result: ProjectGroup[] };
  'project-group:get': { args: [{ id: string }]; result: ProjectGroup | null };
  'project-group:add-project': { args: [{ groupId: string; projectPath: string }]; result: ProjectGroup | null };
  'project-group:remove-project': { args: [{ groupId: string; projectPath: string }]; result: ProjectGroup | null };
  'project-group:rename': { args: [{ groupId: string; name: string }]; result: ProjectGroup | null };
  'project-group:delete': { args: [{ groupId: string }]; result: void };

  // Multi-project workspace listing
  'workspace:list-multi': { args: [{ parentRepos: string[] }]; result: Workspace[] };
  'workspace-group:create': { args: [{ name: string; workspaceIds?: string[] }]; result: WorkspaceGroup };
  'workspace-group:get': { args: [{ workspaceId: string }]; result: WorkspaceGroupLookupResult | null };
  'workspace-group:list-members': { args: [{ groupId: string }]; result: WorkspaceGroupMember[] };
  'workspace-group:add-member': {
    args: [{ groupId: string; workspaceId: string; role?: 'primary' | 'sibling' }];
    result: WorkspaceGroup | null;
  };
  'workspace-group:remove-member': { args: [{ groupId: string; workspaceId: string }]; result: WorkspaceGroup | null };
  'workspace-group:delete': { args: [{ groupId: string }]; result: void };
}

// Events main sends to renderer
export interface IpcEvents {
  'agent:message': { taskId: string; message: AgentMessage };
  'agent:done': { taskId: string; error?: string };
  'agent:diff': { taskId: string; key: string; diff: DiffData };
  'agent:permission': { taskId: string; requestId: string; toolName: string; description: string; action?: string; path?: string };
  'agent:stall': { taskId: string; stallInfo: { type: string; toolName?: string; durationMs: number; autoRestartsRemaining: number } };
  'agent:todo': { taskId: string; todoItems: TodoItem[] };
  'agent:todo-update': { taskId: string; stepId: number; status: TodoItem['status']; label?: string };
  'agent:skills': { taskId: string; skills: Array<{ id: string; name: string; description?: string }> };
  'workspace:status': { workspaceId: string; status: WorkspaceStatus };
  'workspace:outcome': { workspaceId: string; outcome: WorkspaceOutcome };
  'workspace:checkpoint': { workspaceId: string; checkpoint: Checkpoint };
  'workspace:updated': { workspaceId: string; branch: string; name: string; worktreePath?: string };
  'workspace:completion': { workspaceId: string; taskId: string; suggestedMergeTarget: string };
  'workspace:created': { workspace: Workspace };
  'workspace:deleted': { workspaceId: string };
  'workspace:operation': WorkspaceOperation;
  'terminal:data': { id: string; data: string };
  'terminal:exit': { id: string; exitCode?: number };
  'terminal:integration': { id: string; event: TerminalIntegrationEvent };
  'terminal:agent-create': { id: string; command: string; cwd: string; workspaceId?: string; workspaceName?: string };
  'terminal:agent-kill': { id: string };
  'config:changed': { config: FluxConfig };
  'window:fullscreen-changed': { isFullscreen: boolean };
  'repomap:status': RepoMapIpcStatus;
  'usage:live-update': LiveUsageOverview;
  'ipc:activity': IpcActivity;
}

export type IpcActivityPhase = 'request' | 'response' | 'event' | 'error';

export interface IpcActivity {
  id: string;
  channel: string;
  phase: IpcActivityPhase;
  direction: 'renderer->main' | 'main->renderer';
  timestamp: number;
  taskId?: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  summary?: string;
  payloadPreview?: string;
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
  preferredIde?: 'code' | 'cursor' | 'zed';
  defaultAgent: string;
  defaultModel: string;
  subagentModel?: string;
  defaultThinking: ThinkingLevel;
  defaultMode: TaskMode;
  quickCreateDirect?: boolean;
  qualityGateCommands: string[];
  qualityGateMaxRetries: number;
  customAgentPaths: Record<string, string>;
  zoomLevel?: number;
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

  // Multi-project state
  lastActiveGroupId?: string;
  openProjects?: string[];
  activeProjectPath?: string;
}

export interface RemotePairingCode {
  code: string;
  expiresAt: number;
}

export interface RemoteClientInfo {
  id: string;
  clientName: string;
  tokenPreview: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  lastAddress?: string | null;
}

export interface RemoteServerStatus {
  enabled: boolean;
  version: string;
  port: number;
  hostname: string;
  advertised: boolean;
  connectionCount: number;
  pairedClientCount: number;
  networkAddresses: string[];
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

export type WorkspaceDiffScope = 'all' | 'committed' | 'uncommitted';

export type WorkspaceDiscardScope = 'all' | 'uncommitted';

export interface WorkspaceDiffSections {
  committed: DiffFile[];
  uncommitted: DiffFile[];
}

export interface Workspace {
  id: string;
  name: string;
  parentRepo: string;
  branch: string;
  /** The branch that was checked out in the parent repo when this workspace was created. */
  baseBranch?: string;
  status: WorkspaceStatus;
  outcome: WorkspaceOutcome;
  createdAt: number;
  updatedAt: number;
  agentId: string;
  model: string;
  mode: TaskMode;
  thinking?: ThinkingLevel;
  planAgentId?: string;
  planModel?: string;
  planThinking?: ThinkingLevel;
  actAgentId?: string;
  actModel?: string;
  actThinking?: ThinkingLevel;
  /** SSH host for remote workspaces. Undefined = local workspace. */
  sshHost?: string;
  worktreePath: string;
  /** When true, the workspace operates directly on the parent repo (no worktree/branch). */
  direct?: boolean;
  sessionId?: string;
}

export interface WorkspaceSession {
  id: number;
  workspaceId: string;
  sessionId: string;
  taskId?: string;
  label?: string;
  position: number;
  createdAt: number;
}

export interface WorkspaceGroupMember {
  groupId: string;
  workspaceId: string;
  role: 'primary' | 'sibling';
  position: number;
  workspaceName: string;
  branch: string;
  parentRepo: string;
  worktreePath: string;
  outcome: WorkspaceOutcome;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  projectGroupId?: string;
  createdAt: number;
  members: WorkspaceGroupMember[];
}

export interface WorkspaceGroupLookupResult {
  group: WorkspaceGroup;
  siblings: Array<{
    workspaceId: string;
    role: 'primary' | 'sibling';
    worktreePath: string;
    parentRepo: string;
    branch: string;
    label: string;
    outcome: WorkspaceOutcome;
  }>;
}

export type WorkspaceStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error' | 'merging';

export type WorkspaceOutcome = 'in_progress' | 'planned' | 'ready_for_pr' | 'reviewing' | 'changes_requested' | 'ready_to_merge' | 'merged' | 'ready_to_archive';

export type WorkspaceOperationKind = 'archive';

export type WorkspaceOperationStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type WorkspaceOperationStage =
  | 'queued'
  | 'releasing_tasks'
  | 'checking_repo'
  | 'resolving_branch'
  | 'removing_git_worktree'
  | 'removing_git_branch'
  | 'removing_worktree_files'
  | 'cleaning_db'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkspaceOperation {
  id: string;
  workspaceId: string;
  kind: WorkspaceOperationKind;
  status: WorkspaceOperationStatus;
  stage: WorkspaceOperationStage;
  progress: number;
  message: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  cancellable: boolean;
}

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
  isExpired: boolean;
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

export interface McpServerStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
  tools?: string[];
}

export interface WorkspaceScript {
  name: string;
  command: string;
  source: 'package.json' | 'detected';
}

export interface MergePreview {
  commitsAhead: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  conflicts: string[];
  canFastForward: boolean;
}

export interface WorkspaceDiskUsage {
  workspaceId: string;
  name: string;
  branch: string;
  sizeBytes: number;
  lastActivity: number;
  isStale: boolean;
}

export interface WorkspaceGitState {
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  hasPendingChanges: boolean;
  isMerged: boolean;
  warnings: string[];
  worktreeDeleted?: boolean;
}

export interface GitLogEntry {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
}

export interface ActiveTaskInfo {
  taskId: string;
  agentId: string;
  workspaceId?: string;
  isAlive: boolean;
  pid?: number;
}

export type TerminalIntegrationEvent =
  | { type: 'cwd'; cwd: string }
  | { type: 'prompt-start' }
  | { type: 'command-start' }
  | { type: 'command-finish'; exitCode: number };
