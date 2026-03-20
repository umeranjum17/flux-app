import os, { networkInterfaces } from 'os';
import type { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { logDiagnostic } from '../diagnostics/logger';
import type { RemoteControlService } from './control-service';
import type { RemoteAuthService } from './auth-service';
import type { RemoteEventBus } from './event-bus';
import {
  buildJsonRpcError,
  buildJsonRpcNotification,
  buildJsonRpcResult,
  isRemoteEventChannel,
  isRemoteRpcMethod,
  parseJsonRpcMessage,
  RemoteRpcError,
  type JsonRpcRequest,
  type RemoteAuthParams,
  type RemoteClientInfo,
  type RemoteServerStatus,
} from './protocol';

const REMOTE_SERVER_PORT = 19275;
const PROTOCOL_VERSION = '1';
const AUTH_TIMEOUT_MS = 30_000;
const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

interface RemoteSocketState {
  authenticated: boolean;
  client: RemoteClientInfo | null;
  authTimer: NodeJS.Timeout | null;
}

interface RemoteControlServerOptions {
  authService: RemoteAuthService;
  controlService: RemoteControlService;
  eventBus: RemoteEventBus;
}

export class RemoteControlServer {
  private readonly sockets = new Map<WebSocket, RemoteSocketState>();
  private readonly unsubscribers: Array<() => void> = [];
  private wss: WebSocketServer | null = null;

  constructor(private readonly options: RemoteControlServerOptions) {}

  start(): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      host: '0.0.0.0',
      port: REMOTE_SERVER_PORT,
      maxPayload: MAX_PAYLOAD_BYTES,
    });

    this.wss.on('connection', (socket, request) => {
      const authTimer = setTimeout(() => {
        socket.close(4001, 'Authentication timeout');
      }, AUTH_TIMEOUT_MS);

      this.sockets.set(socket, {
        authenticated: false,
        client: null,
        authTimer,
      });

      socket.on('message', (message) => {
        void this.handleMessage(socket, String(message), request.socket.remoteAddress ?? null);
      });
      socket.on('close', () => {
        const state = this.sockets.get(socket);
        if (state?.authTimer) clearTimeout(state.authTimer);
        this.sockets.delete(socket);
      });
      socket.on('error', (error) => {
        logDiagnostic('remote-server', 'socket error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    this.wss.on('listening', () => {
      const address = this.wss?.address() as AddressInfo | null;
      logDiagnostic('remote-server', 'listening', {
        host: address?.address,
        port: address?.port,
      });
    });

    this.wss.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException).code;
      logDiagnostic('remote-server', 'server error', { error: msg, code });
      if (code === 'EADDRINUSE') {
        logDiagnostic('remote-server', `port ${REMOTE_SERVER_PORT} already in use — remote control disabled`);
        this.wss?.close();
        this.wss = null;
      }
    });

    this.subscribeToEvents();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    for (const [socket, state] of this.sockets.entries()) {
      if (state.authTimer) clearTimeout(state.authTimer);
      socket.close();
    }
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;
  }

  getStatus(advertised: boolean): RemoteServerStatus {
    return {
      enabled: !!this.wss,
      version: PROTOCOL_VERSION,
      port: REMOTE_SERVER_PORT,
      hostname: os.hostname(),
      advertised,
      connectionCount: [...this.sockets.values()].filter((socket) => socket.authenticated).length,
      pairedClientCount: this.options.authService.countActiveClients(),
      networkAddresses: getLanAddresses(),
    };
  }

  private subscribeToEvents(): void {
    const channels = [
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

    for (const channel of channels) {
      this.unsubscribers.push(
        this.options.eventBus.subscribe(channel, (payload) => {
          this.broadcast(channel, payload);
        }),
      );
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    if (!isRemoteEventChannel(channel)) return;
    const message = JSON.stringify(buildJsonRpcNotification(channel, payload));
    for (const [socket, state] of this.sockets.entries()) {
      if (!state.authenticated || socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        socket.close(4002, 'Backpressure limit exceeded');
        continue;
      }
      socket.send(message);
    }
  }

  private async handleMessage(socket: WebSocket, raw: string, remoteAddress: string | null): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = parseJsonRpcMessage(raw);
    } catch (error) {
      const rpcError = error instanceof RemoteRpcError
        ? error
        : new RemoteRpcError(-32700, 'Parse error');
      socket.send(JSON.stringify(buildJsonRpcError(null, rpcError)));
      return;
    }

    const state = this.sockets.get(socket);
    if (!state) return;

    try {
      if (request.method === 'auth:pair') {
        const result = await this.handleAuth(request.params, remoteAddress);
        state.authenticated = true;
        state.client = result.client;
        if (state.authTimer) {
          clearTimeout(state.authTimer);
          state.authTimer = null;
        }
        if (request.id !== undefined && request.id !== null) {
          socket.send(JSON.stringify(buildJsonRpcResult(request.id, {
            authenticated: true,
            token: result.token,
            upgradedFromPairingCode: result.upgradedFromPairingCode,
            clientId: result.client.id,
          })));
        }
        return;
      }

      if (!state.authenticated) {
        throw new RemoteRpcError(-32001, 'Authenticate first via auth:pair');
      }

      if (!isRemoteRpcMethod(request.method)) {
        throw new RemoteRpcError(-32601, `Method not found: ${request.method}`);
      }

      const result = await this.dispatch(request.method, request.params);
      if (request.id !== undefined && request.id !== null) {
        socket.send(JSON.stringify(buildJsonRpcResult(request.id, result)));
      }
    } catch (error) {
      const rpcError = error instanceof RemoteRpcError
        ? error
        : new RemoteRpcError(-32000, error instanceof Error ? error.message : String(error));
      if (request.id !== undefined && request.id !== null) {
        socket.send(JSON.stringify(buildJsonRpcError(request.id, rpcError)));
      }
    }
  }

  private async handleAuth(params: unknown, remoteAddress: string | null) {
    const payload = params as RemoteAuthParams | undefined;
    if (!payload || typeof payload.token !== 'string') {
      throw new RemoteRpcError(-32602, 'auth:pair requires a token');
    }
    try {
      return this.options.authService.authenticateToken(payload.token, payload.clientName, remoteAddress);
    } catch (error) {
      throw new RemoteRpcError(-32001, error instanceof Error ? error.message : 'Authentication failed');
    }
  }

  private requireParam<T>(params: unknown, ...fields: string[]): T {
    if (!params || typeof params !== 'object') {
      throw new RemoteRpcError(-32602, `Expected params object, got ${typeof params}`);
    }
    const obj = params as Record<string, unknown>;
    for (const field of fields) {
      if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
        throw new RemoteRpcError(-32602, `Missing required param: ${field}`);
      }
    }
    return params as T;
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'agents:detect':
        return this.options.controlService.detectAgents();
      case 'agents:active-tasks':
        return this.options.controlService.activeTasks();
      case 'task:approve': {
        const p = this.requireParam<{ taskId: string; requestId: string }>(params, 'taskId', 'requestId');
        return this.options.controlService.approveTask(p.taskId, p.requestId);
      }
      case 'task:deny': {
        const p = this.requireParam<{ taskId: string; requestId: string }>(params, 'taskId', 'requestId');
        return this.options.controlService.denyTask(p.taskId, p.requestId);
      }
      case 'task:answer-question': {
        const p = this.requireParam<{ taskId: string; requestId: string; response: string }>(params, 'taskId', 'requestId', 'response');
        return this.options.controlService.answerTaskQuestion(p.taskId, p.requestId, p.response);
      }
      case 'task:steer': {
        const p = this.requireParam<{
          taskId: string;
          prompt: string;
          images?: string[];
          attachments?: Array<{ path: string; name: string }>;
        }>(params, 'taskId', 'prompt');
        return this.options.controlService.steerTask(p.taskId, p.prompt, p.images, p.attachments);
      }
      case 'sessions:get': {
        const p = this.requireParam<{ id: string }>(params, 'id');
        return this.options.controlService.getSession(p.id);
      }
      case 'sessions:messages': {
        const p = this.requireParam<{ id: string }>(params, 'id');
        return this.options.controlService.sessionMessages(p.id);
      }
      case 'workspace:list-multi': {
        const p = this.requireParam<{ parentRepos: string[] }>(params, 'parentRepos');
        if (!Array.isArray(p.parentRepos)) {
          throw new RemoteRpcError(-32602, 'parentRepos must be an array');
        }
        return this.options.controlService.listMulti(p.parentRepos);
      }
      case 'workspace:active-task': {
        const p = this.requireParam<{ workspaceId: string }>(params, 'workspaceId');
        return this.options.controlService.activeWorkspaceTaskIds(p.workspaceId);
      }
      case 'workspace:list-chats': {
        const p = this.requireParam<{ workspaceId: string }>(params, 'workspaceId');
        return this.options.controlService.listWorkspaceChats(p.workspaceId);
      }
      case 'workspace:spawn-chat': {
        const p = this.requireParam<{
          taskId?: string;
          workspaceId: string;
          prompt: string;
          mode?: 'plan' | 'act' | 'ask' | 'architect';
          agentId?: string;
          model?: string;
          images?: string[];
          attachments?: Array<{ path: string; name: string }>;
        }>(params, 'workspaceId', 'prompt');
        return this.options.controlService.spawnWorkspaceChat(p);
      }
      case 'workspace:stop': {
        const p = this.requireParam<{ workspaceId: string }>(params, 'workspaceId');
        return this.options.controlService.stopWorkspace(p.workspaceId);
      }
      case 'workspace:diff-files': {
        const p = this.requireParam<{ workspaceId: string }>(params, 'workspaceId');
        return this.options.controlService.diffFiles(p.workspaceId);
      }
      case 'workspace:file-diff': {
        const p = this.requireParam<{ workspaceId: string; filePath: string; scope?: 'all' | 'committed' | 'uncommitted' }>(params, 'workspaceId', 'filePath');
        return this.options.controlService.fileDiff(p.workspaceId, p.filePath, p.scope);
      }
      default:
        throw new RemoteRpcError(-32601, `Method not found: ${method}`);
    }
  }
}

function getLanAddresses(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];
  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses.sort();
}

export { PROTOCOL_VERSION, REMOTE_SERVER_PORT };
