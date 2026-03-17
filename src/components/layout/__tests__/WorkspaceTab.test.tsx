import { beforeEach, describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { WorkspaceTab } from '../WorkspaceTab';
import type { Workspace, WorkspaceOperation } from '../../../lib/ipc-api';
import { useChatStore } from '../../../stores/chat';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

let mockApi: MockApi;

const baseWorkspace: Workspace = {
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

function renderWorkspaceTab(
  overrides: Partial<Workspace> = {},
  operation?: WorkspaceOperation,
) {
  const workspace = {
    ...baseWorkspace,
    ...overrides,
  };

  useWorkspaceStore.setState({
    workspaces: new Map([
      ['ws-1', workspace],
    ]),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceOperations: operation
      ? new Map([['ws-1', operation]])
      : new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });

  return render(<WorkspaceTab />);
}

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
});

describe('WorkspaceTab', () => {
  it('keeps planning status on the lifecycle dot without rendering a badge label', () => {
    const view = renderWorkspaceTab();
    const scoped = within(view.container);

    expect(scoped.getByText('Planning pass')).not.toBeNull();
    expect(scoped.getByRole('button', {
      name: 'Planning pass — Planning. Agent is creating a plan.',
    })).not.toBeNull();
    expect(scoped.getByTitle('Agent is creating a plan.')).not.toBeNull();
    expect(scoped.queryByText('Planning')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-planning.bg-info')).not.toBeNull();
  });

  it('uses an attention signal for waiting approval', () => {
    const view = renderWorkspaceTab({
      status: 'waiting_approval',
      mode: 'act',
      updatedAt: 2,
    });
    const scoped = within(view.container);

    expect(scoped.getByRole('button', {
      name: 'Planning pass — Needs approval. Paused — waiting for your approval.',
    })).not.toBeNull();
    expect(scoped.queryByText('Needs Approval')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-needs-approval.bg-warning')).not.toBeNull();
  });

  it('uses an attention signal for waiting input', () => {
    const view = renderWorkspaceTab({
      status: 'waiting_input',
      mode: 'act',
      updatedAt: 3,
    });
    const scoped = within(view.container);

    expect(scoped.getByRole('button', {
      name: 'Planning pass — Needs input. Agent asked a question.',
    })).not.toBeNull();
    expect(scoped.queryByText('Needs Input')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-needs-input.bg-info')).not.toBeNull();
  });

  it('keeps ready-for-review state on the lifecycle dot', () => {
    const view = renderWorkspaceTab({
      status: 'done',
      outcome: 'ready_for_pr',
      mode: 'act',
      updatedAt: 4,
    });
    const scoped = within(view.container);

    expect(scoped.getByRole('button', {
      name: 'Planning pass — Ready for review. Changes are ready to review.',
    })).not.toBeNull();
    expect(scoped.queryByText('Ready for Review')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-review-ready.bg-accent')).not.toBeNull();
  });

  it('keeps blocked state on the lifecycle dot', () => {
    const view = renderWorkspaceTab({
      status: 'error',
      mode: 'act',
      updatedAt: 5,
    });
    const scoped = within(view.container);

    expect(scoped.getByRole('button', {
      name: 'Planning pass — Blocked. Last run failed — needs attention.',
    })).not.toBeNull();
    expect(scoped.queryByText('Blocked')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-blocked.bg-error')).not.toBeNull();
  });

  it('lets archive progress override the sidebar dot signal', () => {
    const view = renderWorkspaceTab(
      {
        status: 'done',
        outcome: 'in_progress',
        mode: 'act',
        updatedAt: 6,
      },
      {
        id: 'archive-1',
        workspaceId: 'ws-1',
        kind: 'archive',
        status: 'running',
        stage: 'removing_git_worktree',
        progress: 0.6,
        message: 'Removing git worktree',
        startedAt: 1,
        updatedAt: 2,
        cancellable: true,
      },
    );
    const scoped = within(view.container);

    expect(scoped.getByRole('button', {
      name: 'Planning pass — Archiving. Workspace archive is in progress. Removing git worktree.',
    })).not.toBeNull();
    expect(scoped.queryByText('Archiving')).toBeNull();
    expect(view.container.querySelector('.lifecycle-dot.workspace-list-signal-working.bg-accent')).not.toBeNull();
  });
});
