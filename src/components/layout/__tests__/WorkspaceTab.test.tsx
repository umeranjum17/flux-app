import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { WorkspaceTab } from '../WorkspaceTab';
import type { Workspace } from '../../../lib/ipc-api';
import { useChatStore } from '../../../stores/chat';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({
    tasks: new Map(),
    activeTaskId: null,
    tabOrder: [],
  });

  useUiStore.setState({
    cwd: '/repo',
    openProjects: ['/repo'],
    collapsedProjects: new Set(),
    isGitRepo: true,
  } as any);

  const workspace: Workspace = {
    id: 'ws-1',
    name: 'Planning pass',
    branch: 'flux/planning-pass',
    parentRepo: '/repo',
    status: 'running',
    outcome: 'in_progress',
    createdAt: 1,
    updatedAt: 1,
    agentId: 'codex',
    model: 'gpt-5',
    mode: 'plan',
    worktreePath: '/repo/.flux/planning-pass',
  };

  useWorkspaceStore.setState({
    workspaces: new Map([
      ['ws-1', workspace],
    ]),
    activeWorkspaceId: null,
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

describe('WorkspaceTab', () => {
  it('keeps planning status to the lifecycle dot without rendering a badge label', () => {
    const { container } = render(<WorkspaceTab />);

    expect(screen.getByText('Planning pass')).not.toBeNull();
    expect(screen.getByTitle('Agent is creating a plan.')).not.toBeNull();
    expect(screen.queryByText('Planning')).toBeNull();
    expect(container.querySelector('.lifecycle-dot.bg-info')).not.toBeNull();
  });
});
