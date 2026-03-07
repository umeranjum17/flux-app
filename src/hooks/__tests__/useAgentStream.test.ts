import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../test/mocks/window-api';
import { useAgentStream } from '../useAgentStream';
import { useChatStore } from '../../stores/chat';

let mockApi: MockApi;

function createTestTask(id = 'task-1') {
  useChatStore.getState().createTask({
    id,
    title: 'Test',
    agentId: 'claude-code',
    model: 'sonnet',
    mode: 'act',
    thinking: 'medium',
    cwd: '/tmp',
  });
}

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;
  // Reset chat store
  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
});

describe('useAgentStream', () => {
  it('subscribes to all three channels on mount', () => {
    renderHook(() => useAgentStream());

    const subscribedChannels = mockApi.on.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(subscribedChannels).toContain('agent:message');
    expect(subscribedChannels).toContain('agent:done');
    expect(subscribedChannels).toContain('agent:permission');
  });

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useAgentStream());

    // Each on() call returns an unsub function; after mount there should be 3 listeners
    expect(mockApi._listeners.get('agent:message')?.size).toBe(1);
    expect(mockApi._listeners.get('agent:done')?.size).toBe(1);
    expect(mockApi._listeners.get('agent:permission')?.size).toBe(1);

    unmount();

    // After unmount, every listener set should be empty
    expect(mockApi._listeners.get('agent:message')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('agent:done')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('agent:permission')?.size ?? 0).toBe(0);
  });

  it('agent:message adds a message to the task', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    const message = {
      type: 'text' as const,
      role: 'assistant' as const,
      content: 'hi',
      timestamp: 1,
    };
    mockApi._emit('agent:message', { taskId: 'task-1', message });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task).toBeDefined();
    expect(task!.messages).toHaveLength(1);
    expect(task!.messages[0].content).toBe('hi');
    expect(task!.messages[0].role).toBe('assistant');
  });

  it('agent:message merges assistant stream chunks from the same run', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:message', {
      taskId: 'task-1',
      message: {
        type: 'text' as const,
        role: 'assistant' as const,
        content: 'Hel',
        timestamp: 1,
      },
    });
    mockApi._emit('agent:message', {
      taskId: 'task-1',
      message: {
        type: 'text' as const,
        role: 'assistant' as const,
        content: 'lo',
        timestamp: 2,
      },
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task!.messages).toHaveLength(1);
    expect(task!.messages[0].content).toBe('Hello');
  });

  it('agent:done sets task status to done', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:done', { taskId: 'task-1' });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task).toBeDefined();
    expect(task!.status).toBe('done');
  });

  it('agent:done with error sets task status to error', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:done', { taskId: 'task-1', error: 'oops' });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task).toBeDefined();
    expect(task!.status).toBe('error');
  });

  it('agent:permission sets pendingApproval on the task', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:permission', {
      taskId: 'task-1',
      requestId: 'r1',
      toolName: 'bash',
      description: 'run cmd',
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task).toBeDefined();
    expect(task!.pendingApproval).toEqual({
      requestId: 'r1',
      toolName: 'bash',
      description: 'run cmd',
      action: undefined,
      path: undefined,
    });
    expect(task!.status).toBe('waiting_approval');
  });

  it('callbacks receive data as first arg (not old _event, data pattern)', () => {
    // The hook destructures data directly from the first callback argument.
    // If the old Electron (_event, data) pattern were used, taskId would be
    // undefined and no store mutation would occur. This test verifies the
    // fix by confirming the store is correctly updated when _emit passes
    // the payload as the sole argument.
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:message', {
      taskId: 'task-1',
      message: {
        type: 'text' as const,
        role: 'assistant' as const,
        content: 'regression check',
        timestamp: 2,
      },
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task!.messages).toHaveLength(1);
    expect(task!.messages[0].content).toBe('regression check');
  });
});
