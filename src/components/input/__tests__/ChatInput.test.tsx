import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../ChatInput';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { useAgentStore } from '../../../stores/agent';
import { useChatStore } from '../../../stores/chat';
import { useSessionStore } from '../../../stores/session';
import { useUiStore } from '../../../stores/ui';

let mockApi: MockApi;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
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
  it('spawns new tasks with the selected agent instead of the default fallback', async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    await user.type(screen.getByPlaceholderText('Ask Flux anything... (@ to mention files)'), 'Fix the bug');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith(
        'task:spawn',
        expect.objectContaining({
          agentId: 'codex',
          model: 'o4-mini',
          cwd: '/workspace',
        }),
      );
    });
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

    await user.type(screen.getByPlaceholderText('Ask Flux anything... (@ to mention files)'), 'Continue');
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
});
