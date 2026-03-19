import { EventEmitter } from 'events';

export type AgentId = 'claude-code' | 'codex' | 'copilot' | 'gemini' | 'openai' | 'ollama';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ThinkingLevel = 'disabled' | 'low' | 'medium' | 'high' | 'xhigh';

export type TaskMode = 'plan' | 'act' | 'ask' | 'architect';

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
  type: 'text' | 'status' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'result' | 'permission_request' | 'question_request' | 'rate_limit' | 'quality_gate' | 'lifecycle';
  role: MessageRole;
  content: string;
  timestamp: number;
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
  // For tool calls
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  // For tool results
  isError?: boolean;
  // For permission requests
  requestId?: string;
  action?: string;
  filePath?: string;
  options?: QuestionOption[];
  questions?: QuestionField[];
  allowFreeform?: boolean;
  placeholder?: string;
  // For results
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  // For file edits
  diff?: string;
  oldContent?: string;
  newContent?: string;
  // For image attachments
  images?: string[];
  attachments?: FileAttachment[];
  // For quality gates
  command?: string;
  exitCode?: number;
  passed?: boolean;
  stdout?: string;
  stderr?: string;
  retryAttempt?: number;
  maxRetries?: number;
  isPreExisting?: boolean;
  /** When true, replace the content of the last matching message instead of appending. */
  replaceLastContent?: boolean;
  // For lifecycle events
  lifecycleState?: string;
  lifecycleLabel?: string;
  // For rate limits
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
  images?: string[]; // base64 encoded
  attachments?: FileAttachment[];
  contextBlock?: string; // Injected repo map context (for logging/diagnostics)
  binaryPath?: string; // Resolved absolute path to the agent binary
  sshHost?: string;      // e.g., "umera@extreme" — spawn agent over SSH
  remoteCwd?: string;    // Remote working directory for SSH mode
  dangerouslyBypassPermissions?: boolean; // Disable agent sandboxing for externally sandboxed runs
  parentTaskId?: string;
  subagentName?: string;
  /** Pre-built conversation context to inject if native session resume fails. */
  fallbackContext?: string;
  contextless?: boolean;
}

export interface AgentHandle extends EventEmitter {
  taskId: string;
  agentId: AgentId;
  /** PID of the underlying child process, if available. */
  pid?: number;
  stop(): Promise<void>;
  approve(requestId: string): void;
  deny(requestId: string): void;
  steer(prompt: string, images?: string[]): void;
  answerQuestion(requestId: string, response: string): void;
  /** Returns true if the underlying process is still running. */
  isAlive(): boolean;
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

