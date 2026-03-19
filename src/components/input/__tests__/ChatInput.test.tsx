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
    bottomPanelOpen: false,
    bottomPanelTab: 'output',
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
          taskId: expect.any(String),
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
          taskId: expect.any(String),
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
          mode: 'act',
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
          taskId: 'task-draft',
          workspaceId: 'ws-1',
          prompt: 'Fix error state',
        }),
      );
    });
    expect(useChatStore.getState().tasks.has('task-draft')).toBe(true);
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'workspace:rename-branch',
      expect.anything(),
    );
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

  it('Shift+Tab in plan mode switches to act and executes the prompt', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setMode('plan');

    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'workspace:create') {
        return Promise.resolve({
          id: 'ws-1',
          name: 'Execute plan',
          parentRepo: '/workspace',
          branch: 'flux/execute-plan-abcd',
          status: 'idle',
          outcome: 'in_progress',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'o4-mini',
          mode: 'act',
          worktreePath: '/workspace/.flux-worktrees/ws-1',
        });
      }
      if (channel === 'workspace:spawn-chat') {
        return Promise.resolve({ taskId: 'task-1', session: { id: 'session-1' } });
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Execute this now');
    await user.keyboard('{Shift>}{Tab}{/Shift}');

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:create',
        expect.objectContaining({
          mode: 'act',
          thinking: 'medium',
        }),
      );
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'workspace:spawn-chat',
        expect.objectContaining({
          prompt: 'Execute this now',
          mode: 'act',
        }),
      );
    });
    expect(useUiStore.getState().mode).toBe('act');
  });

  it('Shift+Tab after a completed plan starts implementing it', async () => {
    const user = userEvent.setup();
    useUiStore.getState().setMode('plan');
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Plan task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'plan',
      thinking: 'medium',
      cwd: '/workspace',
      workspaceId: 'ws-1',
      sessionId: 'session-1',
    });
    useChatStore.getState().setPlanData('task-1', {
      summary: 'Implement the requested fix',
      sections: [],
      steps: [{ title: 'Update shift-tab behavior', details: 'Wire Shift+Tab to plan implementation.' }],
    });
    useChatStore.getState().setTaskStatus('task-1', 'done');

    render(<ChatInput />);

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Shift>}{Tab}{/Shift}');

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          taskId: 'task-1',
          workspaceId: 'ws-1',
          prompt: 'Implement the plan above.',
          mode: 'act',
          sessionId: 'session-1',
        }),
      );
    });
    expect(useUiStore.getState().mode).toBe('act');
    expect(useChatStore.getState().tasks.get('task-1')?.status).toBe('running');
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'workspace:create',
      expect.anything(),
    );
    expect(mockApi.invoke).not.toHaveBeenCalledWith(
      'workspace:spawn-chat',
      expect.anything(),
    );
  });

  it('shows a Shift+Tab prompt when a plan task is done', () => {
    useUiStore.getState().setMode('plan');
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Plan task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'plan',
      thinking: 'medium',
      cwd: '/workspace',
      sessionId: 'session-1',
    });
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: [
        '## Summary',
        'Implement the plan in act mode.',
        '## Steps',
        '1. Add plan completion hint',
        '2. Add tests',
        '3. Validate behavior',
      ].join('\n'),
      timestamp: Date.now(),
    });
    useChatStore.getState().setTaskStatus('task-1', 'done');

    render(<ChatInput />);

    expect(screen.getByText('Plan complete. Press Shift+Tab to switch to Act and start implementing.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Plan complete. Press Shift+Tab to switch to Act and start implementing.')).toBeInTheDocument();
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

  it('shows attachment context hints for selected files', async () => {
    useUiStore.getState().setPendingMention({ path: '/workspace/src/app.ts', name: 'app.ts' });

    render(<ChatInput />);

    await waitFor(() => {
      expect(screen.getByText('1 file attached')).toBeInTheDocument();
    });

    expect(screen.getByText('Saved to `.context/attachments.md` in workspace runs')).toBeInTheDocument();
    expect(screen.getByText('/workspace/src/app.ts')).toBeInTheDocument();
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

  it('uses latest model when sending immediately after selector change', async () => {
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

    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'task:spawn') {
        return Promise.resolve({ taskId: 'task-1', session: { id: 'session-1' } });
      }
      if (channel === 'task:stop') {
        return Promise.resolve(undefined);
      }
      if (channel === 'task:steer') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    await user.type(getChatInput(), 'Use the newest model');
    useAgentStore.setState({
      selectedAgentId: 'codex',
      selectedModel: 'gpt-5.4',
      selectedThinking: 'high',
      dynamicModels: [],
      modelsLoading: false,
    });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          taskId: 'task-1',
          prompt: 'Use the newest model',
          agentId: 'codex',
          model: 'gpt-5.4',
          thinking: 'high',
        }),
      );
    });
  });

  it('runs terminal mode commands in the Flux terminal instead of shell:exec', async () => {
    const user = userEvent.setup();
    useUiStore.setState({
      inputMode: 'terminal',
    });
    useWorkspaceStore.setState({
      workspaces: new Map([
        ['ws-1', {
          id: 'ws-1',
          name: 'Terminal Workspace',
          parentRepo: '/workspace',
          branch: 'flux/terminal-workspace',
          status: 'idle',
          outcome: 'in_progress',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'o4-mini',
          mode: 'act',
          worktreePath: '/workspace/.flux-worktrees/ws-1',
        }],
      ]),
      activeWorkspaceId: 'ws-1',
    });

    mockApi.invoke.mockImplementation((channel: string, payload?: any) => {
      if (channel === 'completion:providers') {
        return Promise.resolve({ providers: [] });
      }
      if (channel === 'terminal:create') {
        return Promise.resolve({ id: payload?.id ?? 'term-1', shellName: 'zsh' });
      }
      return Promise.resolve(undefined);
    });

    render(<ChatInput />);

    const input = screen.getByPlaceholderText('Run a command...');
    await waitFor(() => {
      expect(input).toHaveValue('$ ');
    });
    await user.type(input, 'npm test');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'terminal:create',
        expect.objectContaining({
          command: 'npm test',
          workspaceId: 'ws-1',
        }),
      );
    });

    expect(mockApi.invoke).not.toHaveBeenCalledWith('shell:exec', expect.anything());
  });
});
