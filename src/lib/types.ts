export type AgentId = 'claude-code' | 'codex' | 'gemini' | 'openai' | 'ollama';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';
export type TaskMode = 'plan' | 'act';

export interface FileAttachment {
  path: string;
  name: string;
}

export interface AgentMessage {
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'result' | 'permission_request';
  role: MessageRole;
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  isError?: boolean;
  requestId?: string;
  action?: string;
  filePath?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  diff?: string;
  oldContent?: string;
  newContent?: string;
  images?: string[];
  attachments?: FileAttachment[];
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
  images?: string[];
  attachments?: FileAttachment[];
}

export type TaskStatus = 'idle' | 'running' | 'waiting_approval' | 'done' | 'error';

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
  pendingApproval?: {
    requestId: string;
    toolName: string;
    description: string;
    action?: string;
    path?: string;
  };
}
