export interface Session {
  id: string;
  title: string;
  agentId: string;
  model: string;
  mode: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
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
