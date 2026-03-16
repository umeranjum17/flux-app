import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApi, type MockApi } from '../../../test/mocks/window-api';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { useWorkspaceStore } from '../../stores/workspace';
import { applyWorkspaceArchived, deriveBranchSlugFromSeed, deriveWorkspaceNameFromPrompt, restoreWorkspaceChats } from '../workspace-state';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
  useSessionStore.setState({ sessions: [], loading: false });
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
  useAgentStore.setState({
    agents: [],
    selectedAgentId: 'claude-code',
    selectedModel: 'sonnet',
    selectedThinking: 'medium',
    detecting: false,
    dynamicModels: [],
    modelsLoading: false,
  });
});

describe('workspace naming', () => {
  it('derives concise workspace names from conversational prompts', () => {
    expect(
      deriveWorkspaceNameFromPrompt(
        'the current work tree names are horrible and it just takes what the user has written',
      ),
    ).toBe('Current Work Tree Names Horrible Takes');
  });

  it('drops markdown syntax and stop words from prompt headings', () => {
    expect(deriveWorkspaceNameFromPrompt('## Please fix the flaky CI pipeline for Linux')).toBe(
      'Fix Flaky CI Pipeline Linux',
    );
  });

  it('derives a clean slug from seed text', () => {
    expect(deriveBranchSlugFromSeed('Please add retry logic to API client', 32)).toBe(
      'add-retry-logic-api-client',
    );
  });

  it('falls back to normalized slug when no keywords are found', () => {
    expect(deriveBranchSlugFromSeed('---', 32)).toBe('');
    expect(deriveBranchSlugFromSeed('workspace-20260315', 32)).toBe('workspace-20260315');
  });
});

describe('workspace archive helpers', () => {
  it('archives the active workspace, closes its panels, and retargets to another workspace task', () => {
    const ws1 = {
      id: 'ws-1',
      name: 'One',
      parentRepo: '/repo',
      branch: 'flux/one',
      status: 'idle' as const,
      outcome: 'in_progress' as const,
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act' as const,
      worktreePath: '/repo/ws-1',
    };
    const ws2 = {
      ...ws1,
      id: 'ws-2',
      name: 'Two',
      branch: 'flux/two',
      worktreePath: '/repo/ws-2',
    };

    useWorkspaceStore.getState().addWorkspace(ws1);
    useWorkspaceStore.getState().addWorkspace(ws2);
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      mergingWorkspaceId: 'ws-1',
      changesPanelOpen: true,
      changesPanelWorkspaceId: 'ws-1',
      changesPanelFiles: [{ path: '/repo/ws-1/a.ts', status: 'modified', additions: 1, deletions: 0 }],
      changesPanelSelectedFile: '/repo/ws-1/a.ts',
      changesPanelFileDiff: { oldContent: '', newContent: 'x', unified: '+x' },
    });

    useChatStore.getState().createTask({
      id: 'task-ws-1',
      title: 'Workspace one',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/repo/ws-1',
      workspaceId: 'ws-1',
    });
    useChatStore.getState().createTask({
      id: 'task-ws-2',
      title: 'Workspace two',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/repo/ws-2',
      workspaceId: 'ws-2',
      activate: false,
    });

    applyWorkspaceArchived('ws-1');

    const workspaceState = useWorkspaceStore.getState();
    expect(workspaceState.workspaces.has('ws-1')).toBe(false);
    expect(workspaceState.archivedWorkspaces.has('ws-1')).toBe(true);
    expect(workspaceState.activeWorkspaceId).toBe('ws-2');
    expect(workspaceState.mergingWorkspaceId).toBeNull();
    expect(workspaceState.changesPanelOpen).toBe(false);
    expect(workspaceState.changesPanelWorkspaceId).toBeNull();

    const chatState = useChatStore.getState();
    expect(chatState.tasks.has('task-ws-1')).toBe(false);
    expect(chatState.tasks.has('task-ws-2')).toBe(true);
    expect(chatState.activeTaskId).toBe('task-ws-2');
  });

  it('restores workspace chats without stealing focus when activate is false', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'Archived Workspace',
      parentRepo: '/repo',
      branch: 'flux/archived',
      status: 'idle' as const,
      outcome: 'in_progress' as const,
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'claude-sonnet-4.5',
      mode: 'act' as const,
      worktreePath: '/repo/ws-1',
    };
    const session = {
      id: 'session-1',
      title: 'Recovered chat',
      cwd: '/repo/ws-1',
      agentId: 'claude-code',
      model: 'claude-sonnet-4.5',
      mode: 'act' as const,
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
    };
    const workspaceSessions = [{
      id: 1,
      workspaceId: 'ws-1',
      sessionId: 'session-1',
      taskId: 'task-restored',
      position: 0,
      createdAt: 1,
    }];

    useWorkspaceStore.getState().addWorkspace(workspace);
    useChatStore.getState().createTask({
      id: 'standalone',
      title: 'Current task',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/repo',
    });

    mockApi.invoke.mockImplementation(async (channel: string, args?: { id?: string }) => {
      if (channel === 'sessions:get' && args?.id === 'session-1') return session;
      if (channel === 'sessions:messages' && args?.id === 'session-1') {
        return [{
          id: 1,
          sessionId: 'session-1',
          type: 'text',
          role: 'assistant',
          content: 'Recovered output',
          toolName: null,
          toolInput: null,
          toolCallId: null,
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
          payloadJson: null,
          timestamp: 1,
        }];
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    await restoreWorkspaceChats(workspace, { activate: false, sessions: workspaceSessions });

    const restoredTask = useChatStore.getState().tasks.get('task-restored');
    expect(restoredTask?.workspaceId).toBe('ws-1');
    expect(restoredTask?.sessionId).toBe('session-1');
    expect(restoredTask?.messages).toHaveLength(1);
    expect(useChatStore.getState().activeTaskId).toBe('standalone');
    expect(useWorkspaceStore.getState().workspaceSessions.get('ws-1')).toEqual(workspaceSessions);
    expect(useSessionStore.getState().sessions[0]?.id).toBe('session-1');
  });
});
