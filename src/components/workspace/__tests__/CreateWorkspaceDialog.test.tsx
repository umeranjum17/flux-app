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
    reviewingWorkspaceId: null,
    diffFiles: [],
    selectedFile: null,
    fileDiff: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
  });
});

describe('CreateWorkspaceDialog', () => {
  it('creates the local task before the workspace spawn promise resolves', async () => {
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

    let resolveSpawn: ((value: { session: { id: string } }) => void) | null = null;
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'workspace:create') {
        return Promise.resolve(workspace);
      }
      if (channel === 'workspace:spawn') {
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
      expect(mockApi.invoke).toHaveBeenCalledWith('workspace:spawn', {
        workspaceId: 'ws-1',
        prompt: 'Fix the brittle flows',
        mode: 'act',
      });
    });

    const task = useChatStore.getState().tasks.get('ws-1');
    expect(task).toBeDefined();
    expect(task?.status).toBe('running');
    expect(task?.sessionId).toBeUndefined();
    expect(useWorkspaceStore.getState().workspaces.get('ws-1')?.status).toBe('running');

    resolveSpawn?.({ session: { id: 'session-1' } });

    await waitFor(() => {
      expect(useChatStore.getState().tasks.get('ws-1')?.sessionId).toBe('session-1');
    });
  });
});
