import type { DetectedAgent, AuthResult, AgentMessage, SpawnOptions, TaskMode, ThinkingLevel } from './types';

// Channels the renderer can invoke on main
export interface IpcChannels {
  'agents:detect': { args: []; result: DetectedAgent[] };
  'agents:check-auth': { args: [{ agentId: string }]; result: AuthResult };
  'task:spawn': { args: [SpawnOptions & { agentId?: string }]; result: { taskId: string; session: Session } };
  'task:stop': { args: [{ taskId: string }]; result: void };
  'task:approve': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:deny': { args: [{ taskId: string; requestId: string }]; result: void };
  'task:steer': { args: [{ taskId: string; prompt: string; images?: string[] }]; result: void };
  'sessions:list': { args: []; result: Session[] };
  'sessions:get': { args: [{ id: string }]; result: Session | null };
  'sessions:delete': { args: [{ id: string }]; result: void };
  'sessions:messages': { args: [{ id: string }]; result: SessionMessage[] };
  'config:get': { args: []; result: FluxConfig };
  'config:set': { args: [Partial<FluxConfig>]; result: void };
  'usage:get': { args: []; result: UsageInfo };
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
}

// Events main sends to renderer
export interface IpcEvents {
  'agent:message': { taskId: string; message: AgentMessage };
  'agent:done': { taskId: string; error?: string };
  'agent:permission': { taskId: string; requestId: string; toolName: string; description: string; action?: string; path?: string };
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
  timestamp: number;
}

export interface FluxConfig {
  theme: 'dark' | 'light';
  fontSize: number;
  sendKey: 'cmd+enter' | 'enter';
  defaultAgent: string;
  defaultModel: string;
  defaultThinking: ThinkingLevel;
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
}

export interface UsageInfo {
  daily: { costUsd: number; inputTokens: number; outputTokens: number; requests: number };
  rateLimits: { remaining: number; total: number; resetsAt: number } | null;
}
