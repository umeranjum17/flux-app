import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../test/mocks/window-api';
import { useAgentStream } from '../useAgentStream';
import { useChatStore } from '../../stores/chat';
import { useWorkspaceStore } from '../../stores/workspace';
import { startWorkspaceChat } from '../../lib/workspace-state';

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
  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
  useWorkspaceStore.setState({
    workspaces: new Map(),
    archivedWorkspaces: new Map(),
    activeWorkspaceId: null,
    showArchived: false,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });
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
    expect(subscribedChannels).toContain('agent:stall');
    expect(subscribedChannels).toContain('workspace:status');
    expect(subscribedChannels).toContain('workspace:outcome');
    expect(subscribedChannels).toContain('workspace:checkpoint');
    expect(subscribedChannels).toContain('workspace:updated');
    expect(subscribedChannels).toContain('repomap:status');
    expect(subscribedChannels).toContain('ipc:activity');
  });

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useAgentStream());

    // Each on() call returns an unsub function; after mount there should be listeners
    expect(mockApi._listeners.get('agent:message')?.size).toBe(1);
    expect(mockApi._listeners.get('agent:done')?.size).toBe(1);
    expect(mockApi._listeners.get('agent:permission')?.size).toBe(1);
    expect(mockApi._listeners.get('agent:stall')?.size).toBe(1);
    expect(mockApi._listeners.get('workspace:status')?.size).toBe(1);
    expect(mockApi._listeners.get('workspace:outcome')?.size).toBe(1);
    expect(mockApi._listeners.get('workspace:checkpoint')?.size).toBe(1);
    expect(mockApi._listeners.get('workspace:updated')?.size).toBe(1);
    expect(mockApi._listeners.get('repomap:status')?.size).toBe(1);
    expect(mockApi._listeners.get('ipc:activity')?.size).toBe(1);

    unmount();

    // After unmount, every listener set should be empty
    expect(mockApi._listeners.get('agent:message')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('agent:done')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('agent:permission')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('agent:stall')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('workspace:status')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('workspace:outcome')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('workspace:checkpoint')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('workspace:updated')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('repomap:status')?.size ?? 0).toBe(0);
    expect(mockApi._listeners.get('ipc:activity')?.size ?? 0).toBe(0);
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

    return waitFor(() => {
      const task = useChatStore.getState().tasks.get('task-1');
      expect(task).toBeDefined();
      expect(task!.messages).toHaveLength(1);
      expect(task!.messages[0].content).toBe('hi');
      expect(task!.messages[0].role).toBe('assistant');
    });
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

    return waitFor(() => {
      const task = useChatStore.getState().tasks.get('task-1');
      expect(task!.messages).toHaveLength(1);
      expect(task!.messages[0].content).toBe('Hello');
    });
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
    expect(task!.messages.at(-1)?.type).toBe('error');
    expect(task!.messages.at(-1)?.content).toBe('oops');
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

  it('agent:message question requests set pendingQuestion and waiting_input status', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:message', {
      taskId: 'task-1',
      message: {
        type: 'question_request' as const,
        role: 'assistant' as const,
        content: 'Which direction should I take?',
        timestamp: 3,
        requestId: 'q-1',
        questions: [{
          question: 'Which direction should I take?',
          options: [{ label: 'Backend first' }, { label: 'UI first' }],
          allowFreeform: false,
        }],
        options: [{ label: 'Backend first' }, { label: 'UI first' }],
        allowFreeform: false,
      },
    });

    return waitFor(() => {
      const task = useChatStore.getState().tasks.get('task-1');
      expect(task?.status).toBe('waiting_input');
      expect(task?.pendingQuestion?.requestId).toBe('q-1');
      expect(task?.pendingQuestion?.prompt).toBe('Which direction should I take?');
    });
  });

  it('agent:diff updates task diffs and editedFiles for file activity', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:diff', {
      taskId: 'task-1',
      key: '0-4',
      diff: {
        files: [{
          path: 'src/hooks/useAgentStream.ts',
          additions: 12,
          deletions: 3,
          hunks: [],
        }],
        totalAdditions: 12,
        totalDeletions: 3,
      },
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task?.diffs.get('0-4')?.files[0]?.path).toBe('src/hooks/useAgentStream.ts');
    expect(task?.editedFiles.get('src/hooks/useAgentStream.ts')).toEqual(expect.objectContaining({
      filePath: 'src/hooks/useAgentStream.ts',
      additions: 12,
      deletions: 3,
    }));
  });

  it('agent:stall appends a system activity entry', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('agent:stall', {
      taskId: 'task-1',
      stallInfo: {
        type: 'tool_timeout',
        toolName: 'Bash',
        durationMs: 45_000,
        autoRestartsRemaining: 1,
      },
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task?.systemActivities).toEqual([
      expect.objectContaining({
        category: 'stall',
        label: 'Bash timed out',
        detail: 'No activity for 45s · 1 auto-restart remaining',
      }),
    ]);
  });

  it('workspace events are captured in durable workspace activity', () => {
    useWorkspaceStore.getState().addWorkspace({
      id: 'ws-1',
      name: 'Workspace',
      parentRepo: '/tmp',
      branch: 'flux/workspace',
      status: 'idle',
      outcome: 'in_progress',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      worktreePath: '/tmp/ws-1',
    });
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Workspace task',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/tmp',
      workspaceId: 'ws-1',
    });
    renderHook(() => useAgentStream());

    mockApi._emit('workspace:status', { workspaceId: 'ws-1', status: 'running' });
    mockApi._emit('workspace:outcome', { workspaceId: 'ws-1', outcome: 'ready_for_pr' });
    mockApi._emit('workspace:checkpoint', {
      workspaceId: 'ws-1',
      checkpoint: {
        id: 'cp-1',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        messageIndex: 0,
        gitCommitSha: 'abc123',
        parentSha: 'def456',
        description: 'Saved progress',
        filesChanged: 2,
        additions: 10,
        deletions: 3,
        createdAt: Date.now(),
      },
    });

    expect(useWorkspaceStore.getState().workspaceActivities.get('ws-1')).toEqual([
      expect.objectContaining({
        category: 'workspace',
        label: 'Workspace is running',
      }),
      expect.objectContaining({
        category: 'workspace',
        label: 'Workspace outcome updated',
        detail: 'Ready for PR',
      }),
      expect.objectContaining({
        category: 'checkpoint',
        label: 'Saved progress',
        detail: '2 files · +10 / -3',
      }),
    ]);
  });

  it('captures todo and workspace lifecycle events before workspace spawn resolves', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'Race fix',
      parentRepo: '/tmp',
      branch: 'feature/race-fix',
      status: 'idle' as const,
      outcome: 'in_progress' as const,
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act' as const,
      worktreePath: '/tmp/ws-1',
    };

    useWorkspaceStore.getState().addWorkspace(workspace);

    let resolveSpawn: ((value: { taskId: string; session: any }) => void) | null = null;
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace:spawn-chat') {
        return new Promise((resolve) => {
          resolveSpawn = resolve as typeof resolveSpawn;
        });
      }
      return Promise.resolve(undefined);
    });

    renderHook(() => useAgentStream());

    const pendingStart = startWorkspaceChat({
      taskId: 'task-1',
      workspace,
      prompt: 'Fix the lifecycle race',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
    });

    await waitFor(() => {
      expect(useChatStore.getState().tasks.get('task-1')).toBeDefined();
    });

    mockApi._emit('agent:todo', {
      taskId: 'task-1',
      todoItems: [{ id: 1, label: 'Trace lifecycle IPC', status: 'in_progress' }],
    });
    mockApi._emit('workspace:status', { workspaceId: 'ws-1', status: 'running' });

    expect(useChatStore.getState().tasks.get('task-1')?.todoItems).toEqual([
      { id: 1, label: 'Trace lifecycle IPC', status: 'in_progress' },
    ]);
    expect(useWorkspaceStore.getState().workspaceActivities.get('ws-1')).toEqual([
      expect.objectContaining({
        category: 'workspace',
        label: 'Workspace is running',
      }),
    ]);

    expect(resolveSpawn).not.toBeNull();
    resolveSpawn!({
      taskId: 'task-1',
      session: {
        id: 'session-1',
        title: '[WS] Race fix',
        agentId: 'claude-code',
        model: 'sonnet',
        mode: 'act',
        cwd: '/tmp/ws-1',
        createdAt: 1,
        updatedAt: 1,
        metadata: {},
      },
    });

    await pendingStart;
    expect(useChatStore.getState().tasks.get('task-1')?.sessionId).toBe('session-1');
  });

  it('repomap state changes are surfaced on the active task without duplicate states', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('repomap:status', {
      state: 'building',
      totalFiles: 12,
      parsedFiles: 3,
      totalTags: 0,
      lastBuiltAt: null,
    });
    mockApi._emit('repomap:status', {
      state: 'building',
      totalFiles: 12,
      parsedFiles: 7,
      totalTags: 0,
      lastBuiltAt: null,
    });
    mockApi._emit('repomap:status', {
      state: 'ready',
      totalFiles: 12,
      parsedFiles: 12,
      totalTags: 42,
      lastBuiltAt: Date.now(),
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task?.systemActivities).toHaveLength(2);
    expect(task?.systemActivities[0]).toEqual(expect.objectContaining({
      category: 'repomap',
      label: 'Repo map indexing started',
    }));
    expect(task?.systemActivities[1]).toEqual(expect.objectContaining({
      category: 'repomap',
      label: 'Repo map ready',
      detail: '12 files · 42 tags indexed',
    }));
  });

  it('ipc activity is captured for task-scoped invoke traces', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('ipc:activity', {
      id: 'ipc-1',
      channel: 'task:spawn',
      phase: 'response',
      direction: 'renderer->main',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      timestamp: 10,
      summary: 'session session-1',
      payloadPreview: '{"session":{"id":"session-1"}}',
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task?.systemActivities).toEqual([
      expect.objectContaining({
        category: 'ipc',
        label: 'task:spawn',
        detail: 'response · task task-1 · workspace ws-1 · session session-1',
        payloadPreview: '{"session":{"id":"session-1"}}',
      }),
    ]);
  });

  it('ipc activity is captured for workspace-scoped events without a task shell', () => {
    renderHook(() => useAgentStream());

    mockApi._emit('ipc:activity', {
      id: 'ipc-2',
      channel: 'workspace:archived',
      phase: 'event',
      direction: 'main->renderer',
      workspaceId: 'ws-1',
      timestamp: 20,
      payloadPreview: '{"workspaceId":"ws-1"}',
    });

    expect(useWorkspaceStore.getState().workspaceActivities.get('ws-1')).toEqual([
      expect.objectContaining({
        category: 'ipc',
        label: 'workspace:archived',
        detail: 'event · workspace ws-1',
      }),
    ]);
  });

  it('filters duplicate ipc events that already render elsewhere', () => {
    createTestTask('task-1');
    renderHook(() => useAgentStream());

    mockApi._emit('ipc:activity', {
      id: 'ipc-3',
      channel: 'workspace:status',
      phase: 'event',
      direction: 'main->renderer',
      workspaceId: 'ws-1',
      timestamp: 30,
    });

    const task = useChatStore.getState().tasks.get('task-1');
    expect(task?.systemActivities ?? []).toHaveLength(0);
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

    return waitFor(() => {
      const task = useChatStore.getState().tasks.get('task-1');
      expect(task!.messages).toHaveLength(1);
      expect(task!.messages[0].content).toBe('regression check');
    });
  });
});
