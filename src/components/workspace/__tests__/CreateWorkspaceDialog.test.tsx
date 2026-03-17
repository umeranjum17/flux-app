import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateWorkspaceDialog } from '../CreateWorkspaceDialog';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { useAgentStore } from '../../../stores/agent';
import { useChatStore } from '../../../stores/chat';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useAgentStore.setState({
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        path: '/usr/bin/codex',
        version: '1.0.0',
        available: true,
        models: ['gpt-5-codex'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
    ],
    selectedAgentId: 'codex',
    selectedModel: 'gpt-5-codex',
    selectedThinking: 'medium',
    dynamicModels: [],
    modelsLoading: false,
    detecting: false,
  });

  useUiStore.setState({
    cwd: '/repo',
  } as any);

  useChatStore.setState({
    tasks: new Map(),
    activeTaskId: null,
    tabOrder: [],
  });

  useWorkspaceStore.setState({
    workspaces: new Map(),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceOperations: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });
});

describe('CreateWorkspaceDialog', () => {
  it('creates a workspace chat once the workspace spawn resolves', async () => {
    const user = userEvent.setup();
    const workspace = {
      id: 'ws-1',
      name: 'Hardening pass',
      parentRepo: '/repo',
      branch: 'flux-hardening',
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'codex',
      model: 'gpt-5-codex',
      worktreePath: '/repo/.flux-worktrees/ws-1',
    };

    let resolveSpawn: ((value: { taskId: string; session: Record<string, unknown> }) => void) | null = null;
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace:create') {
        return Promise.resolve(workspace);
      }
      if (channel === 'workspace:spawn-chat') {
        return new Promise((resolve) => {
          resolveSpawn = resolve as typeof resolveSpawn;
        });
      }
      return Promise.resolve(undefined);
    });

    render(<CreateWorkspaceDialog onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('e.g., Add auth system'), 'Hardening pass');
    await user.type(screen.getByPlaceholderText('What should this agent work on?'), 'Fix the brittle flows');
    await user.click(screen.getByRole('button', { name: 'Create & Start' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith('workspace:spawn-chat', {
        taskId: expect.any(String),
        workspaceId: 'ws-1',
        prompt: 'Fix the brittle flows',
        agentId: 'codex',
        model: 'gpt-5-codex',
        mode: 'act',
      });
    });

    expect(useChatStore.getState().tasks.size).toBe(1);
    const pendingTask = Array.from(useChatStore.getState().tasks.values())[0];
    expect(pendingTask?.status).toBe('running');
    expect(pendingTask?.messages[0]?.content).toBe('Fix the brittle flows');

    expect(resolveSpawn).not.toBeNull();
    resolveSpawn!({
      taskId: pendingTask!.id,
      session: {
        id: 'session-1',
        title: '[WS] Hardening pass',
        agentId: 'codex',
        model: 'gpt-5-codex',
        mode: 'act',
        cwd: '/repo/.flux-worktrees/ws-1',
        createdAt: 1,
        updatedAt: 1,
        metadata: {},
      },
    });

    await waitFor(() => {
      expect(useChatStore.getState().tasks.get(pendingTask!.id)?.sessionId).toBe('session-1');
    });

    const task = useChatStore.getState().tasks.get(pendingTask!.id);
    expect(task).toBeDefined();
    expect(task?.status).toBe('running');
    expect(task?.workspaceId).toBe('ws-1');
    expect(task?.messages[0]?.content).toBe('Fix the brittle flows');
    expect(useWorkspaceStore.getState().workspaces.get('ws-1')?.status).toBe('running');
  });
});
