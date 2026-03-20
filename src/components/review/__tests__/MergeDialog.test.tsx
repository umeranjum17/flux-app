import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { MergeDialog } from '../MergeDialog';
import { useChatStore } from '../../../stores/chat';
import { useSessionStore } from '../../../stores/session';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;

const workspace = {
  id: 'ws-1',
  name: 'Hardening pass',
  parentRepo: '/repo',
  branch: 'flux-hardening',
  status: 'done' as const,
  outcome: 'in_progress' as const,
  createdAt: 1,
  updatedAt: 1,
  agentId: 'codex',
  model: 'gpt-5-codex',
  mode: 'act' as const,
  worktreePath: '/repo/.flux-worktrees/ws-1',
};

beforeEach(() => {
  cleanup();
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useUiStore.setState({
    gitBranch: 'master',
  } as any);

  useChatStore.setState({
    tasks: new Map(),
    activeTaskId: null,
    tabOrder: [],
  });

  useSessionStore.setState({
    sessions: [],
    loading: false,
  });

  useWorkspaceStore.setState({
    workspaces: new Map([[workspace.id, workspace]]),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceSessions: new Map(),
  });
});

describe('MergeDialog', () => {
  it('prefills the target branch from the current repository branch', () => {
    render(
      <MergeDialog
        workspace={workspace}
        onClose={() => {}}
      />,
    );

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('master');
  });

  it('starts a merge task in the workspace worktree with agent git access', async () => {
    const onClose = vi.fn();
    let spawnedTaskId: string | undefined;
    mockApi.invoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'task:spawn') {
        spawnedTaskId = args?.taskId;
        return {
          taskId: args?.taskId,
          session: {
            id: 'session-1',
            title: '[WS] Hardening pass',
            agentId: 'codex',
            model: 'gpt-5-codex',
            mode: 'act',
            cwd: '/repo/.flux-worktrees/ws-1',
            createdAt: 1,
            updatedAt: 1,
            metadata: { workspaceId: workspace.id },
          },
        };
      }
      return undefined;
    });

    render(<MergeDialog workspace={workspace} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Agent Merge' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          taskId: expect.any(String),
          workspaceId: workspace.id,
          agentId: workspace.agentId,
          model: workspace.model,
          mode: 'act',
          thinking: 'medium',
          cwd: workspace.worktreePath,
          autoApprovePermissions: true,
          workspaceAction: 'merge',
          mergeContext: {
            targetBranch: 'master',
            squash: true,
          },
          prompt: expect.stringContaining('Follow the merge instructions provided above'),
        }),
      );
    });

    const mergePrompt = mockApi.invoke.mock.calls.find(([channel]) => channel === 'task:spawn')?.[1]?.prompt;
    expect(mergePrompt).toContain('Strategy: squash merge.');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(spawnedTaskId).toBeTruthy();
    const task = useChatStore.getState().tasks.get(spawnedTaskId!);
    expect(task).toEqual(expect.objectContaining({
      id: spawnedTaskId,
      agentId: 'codex',
      cwd: workspace.worktreePath,
      workspaceId: workspace.id,
      status: 'running',
    }));

    expect(useSessionStore.getState().sessions[0]?.id).toBe('session-1');
    expect(useWorkspaceStore.getState().workspaces.get(workspace.id)?.sessionId).toBe('session-1');
  });

  it('shows an error if the merge task cannot be started', async () => {
    const onClose = vi.fn();
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'task:spawn') {
        throw new Error('spawn failed');
      }
      return undefined;
    });

    render(<MergeDialog workspace={workspace} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Agent Merge' }));

    await waitFor(() => {
      expect(screen.getByText('spawn failed')).toBeInTheDocument();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('defaults to agent merge and hides direct merge', () => {
    render(<MergeDialog workspace={workspace} onClose={() => {}} />);

    expect(screen.queryByRole('button', { name: /Direct Merge/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Agent Merge' })).toBeEnabled();
  });
});
