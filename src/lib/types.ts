export type AgentId = 'claude-code' | 'codex' | 'gemini' | 'openai' | 'ollama';
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
  type: 'text' | 'status' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'result' | 'permission_request' | 'question_request' | 'rate_limit' | 'quality_gate' | 'shell_result';
  role: MessageRole;
  content: string;
  timestamp: number;
  statusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
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

export type TaskStatus = 'idle' | 'running' | 'waiting_approval' | 'waiting_input' | 'done' | 'error';

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
  planRevisions?: string[];
  currentStatus?: string;
  currentStatusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
}
