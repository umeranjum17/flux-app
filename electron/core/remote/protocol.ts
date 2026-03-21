export const REMOTE_RPC_METHODS = [
  'auth:pair',
  'agents:detect',
  'agents:active-tasks',
  'task:approve',
  'task:deny',
  'task:answer-question',
  'task:steer',
  'sessions:get',
  'sessions:messages',
  'workspace:list-multi',
  'workspace:active-task',
  'workspace:list-chats',
  'workspace:spawn-chat',
  'workspace:stop',
  'workspace:diff-files',
  'workspace:file-diff',
  'config:get',
  'workspace:create',
  'workspace:create-quick',
  'workspace:delete',
  'workspace:archive',
  'workspace:rename-branch',
  'workspace:set-outcome',
  'workspace:update',
  'workspace:merge-preview',
  'workspace:create-pr',
] as const;

export const REMOTE_EVENT_CHANNELS = [
  'agent:message',
  'agent:done',
  'agent:permission',
  'agent:todo',
  'agent:todo-update',
  'workspace:status',
  'workspace:outcome',
  'workspace:updated',
  'workspace:created',
  'workspace:deleted',
  'workspace:operation',
  'workspace:completion',
] as const;

export type RemoteRpcMethod = (typeof REMOTE_RPC_METHODS)[number];
export type RemoteEventChannel = (typeof REMOTE_EVENT_CHANNELS)[number];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: RemoteEventChannel;
  params: unknown;
}

export interface RemoteAuthParams {
  token: string;
  clientName?: string;
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

export class RemoteRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RemoteRpcError';
    this.code = code;
    this.data = data;
  }
}

export function isRemoteRpcMethod(value: string): value is RemoteRpcMethod {
  return (REMOTE_RPC_METHODS as readonly string[]).includes(value);
}

export function isRemoteEventChannel(value: string): value is RemoteEventChannel {
  return (REMOTE_EVENT_CHANNELS as readonly string[]).includes(value);
}

export function parseJsonRpcMessage(raw: string): JsonRpcRequest {
  const parsed = JSON.parse(raw) as Partial<JsonRpcRequest>;
  if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
    throw new RemoteRpcError(-32600, 'Invalid JSON-RPC request');
  }
  return {
    jsonrpc: '2.0',
    id: parsed.id ?? null,
    method: parsed.method,
    params: parsed.params,
  };
}

export function buildJsonRpcResult(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function buildJsonRpcError(
  id: string | number | null,
  error: RemoteRpcError,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    },
  };
}

export function buildJsonRpcNotification(
  method: RemoteEventChannel,
  params: unknown,
): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
