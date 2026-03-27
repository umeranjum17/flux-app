import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { MergeDialog } from '../MergeDialog';
import { useAgentStore } from '../../../stores/agent';
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

const defaultConfig = {
  defaultMergeAgent: undefined,
  defaultMergeModel: undefined,
  defaultMergeThinking: undefined,
};

beforeEach(() => {
  cleanup();
  mockApi = createMockApi();
  mockApi.invoke.mockImplementation(async (channel: string, ...rest: any[]) => {
    if (channel === 'config:get') return defaultConfig;
    return undefined;
  });
  (window as any).api = mockApi;

  useUiStore.setState({
    gitBranch: 'master',
  } as any);

  useAgentStore.setState({
    agents: [
      {
        id: 'claude-code',
        name: 'Claude Code',
        path: '/usr/bin/claude',
        version: '1.0.0',
        available: true,
        models: ['sonnet', 'haiku'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
      {
        id: 'copilot',
        name: 'GitHub Copilot',
        path: '/usr/bin/copilot',
        version: '1.0.0',
        available: true,
        models: ['gpt-5.4', 'gpt-5.4-mini'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
      {
        id: 'codex',
        name: 'Codex',
        path: '/usr/bin/codex',
        version: '1.0.0',
        available: true,
        models: ['gpt-5-codex'],
        supportsThinking: false,
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
      if (channel === 'config:get') return defaultConfig;
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
      if (channel === 'config:get') return defaultConfig;
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

  it('lets the user pick a cheaper merge model before spawning', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockImplementation(async (channel: string, args?: any) => {
      if (channel === 'config:get') return defaultConfig;
      if (channel === 'agents:list-models') {
        if (args?.agentId === 'claude-code') {
          return [
            { id: 'haiku', name: 'haiku' },
            { id: 'sonnet', name: 'sonnet' },
          ];
        }
        return [];
      }
      if (channel === 'task:spawn') {
        return {
          taskId: args?.taskId,
          session: {
            id: 'session-1',
            title: '[WS] Hardening pass',
            agentId: args?.agentId,
            model: args?.model,
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

    render(<MergeDialog workspace={workspace} onClose={() => {}} />);

    // Click the "Merge Agent" picker button (not the "Agent Merge" mode button)
    await user.click(screen.getByRole('button', { name: /Merge Agent.*Pick a cheaper/i }));
    await user.click(screen.getByRole('button', { name: /Claude Code/i }));
    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith('agents:list-models', { agentId: 'claude-code' });
    });

    await user.selectOptions(screen.getByRole('combobox'), 'haiku');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Start Agent Merge' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          agentId: 'claude-code',
          model: 'haiku',
        }),
      );
    });
  });
});
