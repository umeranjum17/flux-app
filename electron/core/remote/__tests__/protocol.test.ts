import { describe, expect, it } from 'vitest';
import {
  buildJsonRpcError,
  buildJsonRpcNotification,
  buildJsonRpcResult,
  isRemoteEventChannel,
  isRemoteRpcMethod,
  parseJsonRpcMessage,
  RemoteRpcError,
} from '../protocol';

describe('remote protocol', () => {
  it('parses valid JSON-RPC requests', () => {
    expect(parseJsonRpcMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'workspace:list-multi',
      params: { parentRepos: ['/repo'] },
    }))).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'workspace:list-multi',
      params: { parentRepos: ['/repo'] },
    });
  });

  it('rejects malformed JSON-RPC payloads', () => {
    expect(() => parseJsonRpcMessage(JSON.stringify({ method: 'workspace:list-multi' })))
      .toThrow(RemoteRpcError);
  });

  it('builds result, error, and notification envelopes', () => {
    expect(buildJsonRpcResult('1', { ok: true })).toEqual({
      jsonrpc: '2.0',
      id: '1',
      result: { ok: true },
    });

    expect(buildJsonRpcError('2', new RemoteRpcError(-32001, 'Unauthorized', { field: 'token' }))).toEqual({
      jsonrpc: '2.0',
      id: '2',
      error: {
        code: -32001,
        message: 'Unauthorized',
        data: { field: 'token' },
      },
    });

    expect(buildJsonRpcNotification('workspace:status', { workspaceId: 'ws-1', status: 'running' })).toEqual({
      jsonrpc: '2.0',
      method: 'workspace:status',
      params: { workspaceId: 'ws-1', status: 'running' },
    });
  });

  it('recognizes the mobile recovery and question-answer methods', () => {
    expect(isRemoteRpcMethod('task:answer-question')).toBe(true);
    expect(isRemoteRpcMethod('sessions:messages')).toBe(true);
    expect(isRemoteRpcMethod('workspace:list-chats')).toBe(true);
  });

  it('keeps the Flux Mobile RPC surface available', () => {
    const mobileMethods = [
      'auth:pair',
      'agents:detect',
      'agents:active-tasks',
      'task:approve',
      'task:deny',
      'task:steer',
      'workspace:list-multi',
      'workspace:active-task',
      'workspace:spawn-chat',
      'workspace:stop',
      'workspace:diff-files',
      'workspace:file-diff',
    ];

    for (const method of mobileMethods) {
      expect(isRemoteRpcMethod(method)).toBe(true);
    }
  });

  it('keeps the Flux Mobile event stream available', () => {
    const mobileEvents = [
      'agent:message',
      'agent:done',
      'agent:todo',
      'agent:todo-update',
      'workspace:status',
      'workspace:outcome',
      'workspace:updated',
      'workspace:created',
      'workspace:deleted',
    ];

    for (const channel of mobileEvents) {
      expect(isRemoteEventChannel(channel)).toBe(true);
    }
  });
});
