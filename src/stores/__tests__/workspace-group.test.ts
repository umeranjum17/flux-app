import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceGroupLookupResult } from '../../lib/ipc-api';
import { useWorkspaceGroupStore } from '../workspace-group';

function makeLookupResult(groupId: string, workspaceIds: string[]): WorkspaceGroupLookupResult {
  const members = workspaceIds.map((workspaceId, index) => ({
    groupId,
    workspaceId,
    role: index === 0 ? 'primary' as const : 'sibling' as const,
    position: index,
    workspaceName: `Workspace ${workspaceId}`,
    branch: `flux/${workspaceId}`,
    parentRepo: `/repo/${workspaceId}`,
    worktreePath: `/repo/${workspaceId}/.flux/${workspaceId}`,
  }));

  return {
    group: {
      id: groupId,
      name: 'Linked Workspaces',
      createdAt: 1,
      members,
    },
    siblings: members.slice(1).map((member) => ({
      workspaceId: member.workspaceId,
      role: member.role,
      worktreePath: member.worktreePath,
      parentRepo: member.parentRepo,
      branch: member.branch,
      label: member.workspaceName,
    })),
  };
}

describe('useWorkspaceGroupStore', () => {
  beforeEach(() => {
    (window as any).api = {
      invoke: vi.fn(),
    };

    useWorkspaceGroupStore.setState({
      groups: new Map(),
      membersByWorkspace: new Map(),
    });
  });

  it('reindexes cached memberships when a workspace moves to a new group', async () => {
    const oldGroup = makeLookupResult('group-old', ['ws-1', 'ws-2', 'ws-3']);
    useWorkspaceGroupStore.setState((state) => {
      state.groups.set(oldGroup.group.id, oldGroup.group);
      state.membersByWorkspace.set('ws-1', [oldGroup.group.members[1], oldGroup.group.members[2]]);
      state.membersByWorkspace.set('ws-2', [oldGroup.group.members[0], oldGroup.group.members[2]]);
      state.membersByWorkspace.set('ws-3', [oldGroup.group.members[0], oldGroup.group.members[1]]);
    });

    const newGroup = makeLookupResult('group-new', ['ws-2', 'ws-4']);
    (window as any).api.invoke.mockResolvedValue(newGroup);

    await useWorkspaceGroupStore.getState().loadGroupForWorkspace('ws-2');

    const state = useWorkspaceGroupStore.getState();
    expect(state.groups.get('group-old')?.members.map((member) => member.workspaceId)).toEqual(['ws-1', 'ws-3']);
    expect(state.getSiblingsOf('ws-1').map((member) => member.workspaceId)).toEqual(['ws-3']);
    expect(state.getSiblingsOf('ws-3').map((member) => member.workspaceId)).toEqual(['ws-1']);
    expect(state.groups.get('group-new')?.members.map((member) => member.workspaceId)).toEqual(['ws-2', 'ws-4']);
    expect(state.getSiblingsOf('ws-2').map((member) => member.workspaceId)).toEqual(['ws-4']);
  });

  it('removes cached memberships when a workspace no longer belongs to any group', async () => {
    const lookup = makeLookupResult('group-1', ['ws-1', 'ws-2']);
    useWorkspaceGroupStore.setState((state) => {
      state.groups.set(lookup.group.id, lookup.group);
      state.membersByWorkspace.set('ws-1', [lookup.group.members[1]]);
      state.membersByWorkspace.set('ws-2', [lookup.group.members[0]]);
    });

    (window as any).api.invoke.mockResolvedValue(null);

    await useWorkspaceGroupStore.getState().loadGroupForWorkspace('ws-2');

    const state = useWorkspaceGroupStore.getState();
    expect(state.groups.size).toBe(0);
    expect(state.getSiblingsOf('ws-1')).toEqual([]);
    expect(state.getSiblingsOf('ws-2')).toEqual([]);
  });
});
