import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../ChatInput';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { useAgentStore } from '../../../stores/agent';
import { useChatStore } from '../../../stores/chat';
import { useSessionStore } from '../../../stores/session';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;
const defaultPromptPlaceholder = 'Ask to make changes, @mention files, run /commands';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
  useWorkspaceStore.setState({ workspaces: new Map(), activeWorkspaceId: null });
  useSessionStore.setState({ sessions: [], loading: false });
  useUiStore.setState({
    sidebarOpen: true,
    theme: 'dark',
    sendKey: 'cmd+enter',
    mode: 'act',
    activeOverlay: null,
    cwd: '/workspace',
    projectName: 'workspace',
    gitBranch: null,
    gitDirty: false,
    explorerOpen: false,
    terminalOpen: false,
    activeTerminalId: null,
    bottomPanelMode: 'agent',
    sshHost: null,
    sshConnected: false,
    environment: 'local',
    activeFile: null,
    pendingMention: null,
    recentProjects: [],
  });
  useAgentStore.setState({
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        path: '/usr/bin/codex',
        version: '1.0.0',
        available: true,
        models: ['o4-mini'],
        supportsThinking: false,
        authStatus: 'authenticated',
        envKeys: [],
      },
    ],
    selectedAgentId: 'codex',
    selectedModel: 'o4-mini',
    selectedThinking: 'medium',
    detecting: false,
    dynamicModels: [],
    modelsLoading: false,
  });
});

describe('ChatInput', () => {
  const getChatInput = () =>
    screen.getByPlaceholderText('Ask to make changes, @mention files, run /commands');

  it('creates workspace-backed chats with the selected agent by default', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'workspace:create') {
        return Promise.resolve({
          id: 'ws-1',
          name: 'Fix the bug',
          parentRepo: '/workspace',
          branch: 'flux/fix-the-bug-abcd',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'o4-mini',
          worktreePath: '/workspace/.flux-worktrees/ws-1',
        });
      }
      if (channel === 'workspace:spawn-chat') {
        return Promise.resolve({ taskId: 'task-1', session: { id: 'session-1' } });
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Fix the bug');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:create',
        expect.objectContaining({
          agentId: 'codex',
          model: 'o4-mini',
          parentRepo: '/workspace',
        }),
      );
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:spawn-chat',
        expect.objectContaining({
          workspaceId: 'ws-1',
          prompt: 'Fix the bug',
          agentId: 'codex',
          model: 'o4-mini',
        }),
      );
    });
  });

  it('falls back to task:spawn when workspace:spawn-chat is unavailable', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockImplementation((channel: string, ...args: any[]) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'workspace:create') {
        return Promise.resolve({
          id: 'ws-1',
          name: 'Fix the bug',
          parentRepo: '/workspace',
          branch: 'flux/fix-the-bug-abcd',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'o4-mini',
          worktreePath: '/workspace/.flux-worktrees/ws-1',
        });
      }
      if (channel === 'workspace:spawn-chat') {
        return Promise.reject(new Error("No handler registered for 'workspace:spawn-chat'"));
      }
      if (channel === 'task:spawn') {
        return Promise.resolve({ taskId: args[0]?.taskId, session: { id: 'session-legacy' } });
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Fix the bug');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:spawn-chat',
        expect.objectContaining({
          workspaceId: 'ws-1',
          prompt: 'Fix the bug',
        }),
      );
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          workspaceId: 'ws-1',
          prompt: 'Fix the bug',
          agentId: 'codex',
          model: 'o4-mini',
          cwd: '/workspace/.flux-worktrees/ws-1',
        }),
      );
    });
  });

  it('bootstraps draft workspace tabs through workspace:spawn-chat', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      workspaces: new Map([
        ['ws-1', {
          id: 'ws-1',
          name: 'rapid-ripple',
          parentRepo: '/workspace',
          branch: 'flux/rapid-ripple',
          status: 'idle',
          outcome: 'in_progress',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'o4-mini',
          worktreePath: '/workspace/.flux-worktrees/c62ee4fd',
        }],
      ]),
      activeWorkspaceId: 'ws-1',
    });
    useChatStore.getState().createTask({
      id: 'task-draft',
      title: 'New chat',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace/.flux-worktrees/c62ee4fd',
      workspaceId: 'ws-1',
    });

    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'workspace:rename-branch') {
        return Promise.resolve({
          id: 'ws-1',
          name: 'Fix error state',
          parentRepo: '/workspace',
          branch: 'flux/fix-error-state-abcd',
          status: 'idle',
          outcome: 'in_progress',
          createdAt: 1,
          updatedAt: 2,
          agentId: 'codex',
          model: 'o4-mini',
          worktreePath: '/workspace/.flux-worktrees/fix-error-state-abcd',
        });
      }
      if (channel === 'workspace:spawn-chat') {
        return Promise.resolve({ taskId: 'task-1', session: { id: 'session-1' } });
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Fix error state');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:spawn-chat',
        expect.objectContaining({
          workspaceId: 'ws-1',
          prompt: 'Fix error state',
        }),
      );
    });
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'task:spawn',
      expect.objectContaining({
        workspaceId: 'ws-1',
      }),
    );
  });

  it('re-spawns completed tasks instead of steering a missing active run', async () => {
    const user = userEvent.setup();
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Existing task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
      sessionId: 'session-1',
    });
    useChatStore.getState().setTaskStatus('task-1', 'done');

    render(<ChatInput />);

    await user.type(getChatInput(), 'Continue');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          taskId: 'task-1',
          sessionId: 'session-1',
        }),
      );
    });
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'task:steer',
      expect.objectContaining({ taskId: 'task-1' }),
    );
  });

  it('sends attachments as structured metadata instead of mutating the prompt text', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setPendingMention({ path: '/workspace/src/app.ts', name: 'app.ts' });
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Existing task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
      sessionId: 'session-1',
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Review this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          prompt: 'Review this',
          attachments: [{ path: '/workspace/src/app.ts', name: 'app.ts' }],
        }),
      );
    });
    expect(mockApi.invoke).not.toHaveBeenCalledWith('fs:read', expect.anything());
  });

  it('routes replies through task:answer-question while waiting for input', async () => {
    const user = userEvent.setup();
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Existing task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
      sessionId: 'session-1',
    });
    useChatStore.getState().setPendingQuestion('task-1', {
      requestId: 'q-1',
      prompt: 'Which area should I fix first?',
      questions: [{
        question: 'Which area should I fix first?',
        options: [{ label: 'Backend first' }, { label: 'UI first' }],
        allowFreeform: false,
      }],
      options: [{ label: 'Backend first' }, { label: 'UI first' }],
      allowFreeform: false,
      placeholder: 'Answer the active question',
    });

    render(<ChatInput />);

    await user.type(screen.getByPlaceholderText('Answer the active question'), 'Backend first');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:answer-question',
        {
          taskId: 'task-1',
          requestId: 'q-1',
          response: 'Backend first',
        },
      );
    });
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'task:steer',
      expect.anything(),
    );
  });
});
