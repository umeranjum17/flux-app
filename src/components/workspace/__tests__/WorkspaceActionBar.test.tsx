import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceActionBar } from '../WorkspaceActionBar';
import type { Workspace } from '../../../lib/ipc-api';
import { useChatStore } from '../../../stores/chat';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';

vi.mock('../../../hooks/useWorkspaceHasChanges', () => ({
  useWorkspaceHasChanges: () => false,
}));

describe('WorkspaceActionBar', () => {
  beforeEach(() => {
    (window as any).api = {
      invoke: vi.fn().mockResolvedValue(undefined),
    };

    useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
    useUiStore.setState({
      bottomPanelOpen: false,
      bottomPanelTab: 'output',
      bottomPanelMode: 'agent',
      terminalOpen: false,
      activeTerminalId: null,
      pendingWorkspaceTerminalId: null,
    } as any);
    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Bugfix',
      branch: 'flux/bugfix',
      parentRepo: '/repo',
      status: 'idle',
      outcome: 'in_progress',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'codex',
      model: 'gpt-5',
      mode: 'act',
      worktreePath: '/repo/.flux/bugfix',
    };

    useWorkspaceStore.setState({
      workspaces: new Map([
        ['ws-1', workspace],
      ]),
      archivedWorkspaces: new Map(),
      activeWorkspaceId: 'ws-1',
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
  });

  it('opens the terminal tab for the active workspace', async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<WorkspaceActionBar />);

    await user.click(screen.getByTitle('Terminal'));

    const uiState = useUiStore.getState();
    expect(uiState.pendingWorkspaceTerminalId).toBe('ws-1');
    expect(uiState.bottomPanelOpen).toBe(true);
    expect(uiState.bottomPanelTab).toBe('terminal');
    expect(uiState.bottomPanelMode).toBe('terminal');
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'flux:open-workspace-terminal',
    }));
  });
});
