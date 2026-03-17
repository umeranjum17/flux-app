export interface ProjectGroup {
  id: string;
  name: string;
  projects: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentId = 'claude-code' | 'codex' | 'copilot' | 'gemini' | 'openai' | 'ollama';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';
export type TaskMode = 'plan' | 'act';

export interface FileAttachment {
  path: string;
  name: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
  value?: string;
}

export interface QuestionField {
  header?: string;
  question: string;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  placeholder?: string;
  multiSelect?: boolean;
}

export interface AgentMessage {
  type: 'text' | 'status' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'result' | 'permission_request' | 'question_request' | 'rate_limit' | 'quality_gate' | 'shell_result' | 'lifecycle';
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Stable sequence ID assigned when appended to the store — used as React key
   *  so that merging streaming chunks doesn't remount/re-animate elements. */
  _seqId?: number;
  statusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
  errorKind?: 'auth' | 'rate_limit' | 'network' | 'context';
  subagentId?: string;
  subagentName?: string;
  subagentStatus?: 'spawning' | 'running' | 'done' | 'error';
  subagentToolCount?: number;
  subagentTokens?: {
    input: number;
    output: number;
  };
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  isError?: boolean;
  requestId?: string;
  action?: string;
  filePath?: string;
  options?: QuestionOption[];
  questions?: QuestionField[];
  allowFreeform?: boolean;
  placeholder?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  diff?: string;
  oldContent?: string;
  newContent?: string;
  images?: string[];
  attachments?: FileAttachment[];
  command?: string;
  exitCode?: number;
  passed?: boolean;
  stdout?: string;
  stderr?: string;
  retryAttempt?: number;
  maxRetries?: number;
  isPreExisting?: boolean;
  lifecycleState?: string;
  lifecycleLabel?: string;
  rateLimitInfo?: {
    providerId?: 'claude-code' | 'codex';
    status: string;
    resetsAt: number;
    rateLimitType: string;
    utilization: number;
    overageStatus?: string;
    overageResetsAt?: number;
    fetchedAt?: number;
  };
}

export type TaskRunPhase =
  | 'starting'
  | 'progress'
  | 'thinking'
  | 'tool'
  | 'waiting_input'
  | 'waiting_approval'
  | 'responding';

export interface ActiveRunState {
  startedAt: number;
  lastActivityAt: number;
  phase: TaskRunPhase;
  activeToolCallId?: string;
  activeToolName?: string;
}

export interface PendingQuestionState {
  requestId: string;
  prompt: string;
  questions: QuestionField[];
  options?: QuestionOption[];
  allowFreeform: boolean;
  placeholder?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface DetectedAgent {
  id: AgentId;
  name: string;
  path: string;
  version: string;
  available: boolean;
  models: string[];
  supportsThinking: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown';
  envKeys: string[];
}

export interface AuthResult {
  authenticated: boolean;
  message: string;
}

export interface SpawnOptions {
  taskId: string;
  workspaceId?: string; // If set, agent runs inside this workspace's worktree
  prompt: string;
  model?: string;
  mode: TaskMode;
  thinking?: ThinkingLevel;
  cwd: string;
  sessionId?: string;
  resumeSessionId?: string;
  images?: string[];
  attachments?: FileAttachment[];
  contextBlock?: string;
  parentTaskId?: string;
  subagentName?: string;
}

export interface SubagentState {
  name: string;
  status: 'spawning' | 'running' | 'done' | 'error';
  messages: AgentMessage[];
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DiffHunk {
  header: string;
  lines: string[];
}

export interface DiffFileEntry {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffData {
  files: DiffFileEntry[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface AgentHistoryEntry {
  agentId: AgentId;
  model: string;
  fromMessageIndex: number;
}

export interface TodoItem {
  id: number;
  label: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface PlanSection {
  title: string;
  content: string;
}

export interface PlanStep {
  title: string;
  details: string;
}

export interface PlanData {
  summary: string;
  sections: PlanSection[];
  steps: PlanStep[];
}

export type TaskStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error';

export type SystemActivityCategory = 'workspace' | 'checkpoint' | 'repomap' | 'stall' | 'sync' | 'ipc' | 'skill';

export interface SystemActivity {
  id: string;
  category: SystemActivityCategory;
  label: string;
  detail?: string;
  timestamp: number;
  channel?: string;
  phase?: 'request' | 'response' | 'event' | 'error';
  direction?: 'renderer->main' | 'main->renderer';
  payloadPreview?: string;
}

export interface EditedFileEntry {
  filePath: string;
  toolCallId: string;
  additions: number;
  deletions: number;
  timestamp: number;
}

export interface Task {
  id: string;
  title: string;
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking: ThinkingLevel;
  status: TaskStatus;
  messages: AgentMessage[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cwd: string;
  sessionId?: string;
  workspaceId?: string; // Set when this task runs inside a workspace worktree
  rateLimitInfo?: AgentMessage['rateLimitInfo'];
  lastQualityGate?: {
    status: 'passed' | 'failed';
    command: string;
    exitCode: number;
  };
  activeRun?: ActiveRunState;
  pendingApproval?: {
    requestId: string;
    toolName: string;
    description: string;
    action?: string;
    path?: string;
  };
  pendingQuestion?: PendingQuestionState;
  subagents: Map<string, SubagentState>;
  agentHistory: AgentHistoryEntry[];
  rateLimitSuggestion?: { agents: AgentId[] };
  diffs: Map<string, DiffData>;
  editedFiles: Map<string, EditedFileEntry>;
  expandedToolCallIds: Set<string>;
  scrollToToolCallId: string | null;
  planRevisions?: string[];
  planData?: PlanData;
  todoItems?: TodoItem[];
  currentStatus?: string;
  currentStatusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
  activeSkills?: Array<{ id: string; name: string }>;
  systemActivities: SystemActivity[];
}
