import { EventEmitter } from 'events';

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
}

export interface SpawnOptions {
  taskId: string;
  prompt: string;
  model?: string;
  mode: TaskMode;
  thinking?: ThinkingLevel;
  cwd: string;
  sessionId?: string;
  images?: string[]; // base64 encoded
  attachments?: FileAttachment[];
}

export interface AgentHandle extends EventEmitter {
  taskId: string;
  agentId: AgentId;
  stop(): void;
  approve(requestId: string): void;
  deny(requestId: string): void;
  steer(prompt: string, images?: string[]): void;
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
