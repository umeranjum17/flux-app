import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { WorkspaceGroup, WorkspaceGroupLookupResult, WorkspaceGroupMember } from '../lib/ipc-api';

const EMPTY_GROUP_MEMBERS: WorkspaceGroupMember[] = [];

interface WorkspaceGroupState {
  groups: Map<string, WorkspaceGroup>;
  membersByWorkspace: Map<string, WorkspaceGroupMember[]>;
  loadGroupForWorkspace(workspaceId: string): Promise<void>;
  linkWorkspaces(primaryWorkspaceId: string, siblingWorkspaceIds: string[]): Promise<void>;
  unlinkWorkspace(workspaceId: string): Promise<void>;
  dissolveGroup(groupId: string): Promise<void>;
  getSiblingsOf(workspaceId: string): WorkspaceGroupMember[];
  removeWorkspace(workspaceId: string): void;
}

function reindexGroupMembers(state: WorkspaceGroupState, group: WorkspaceGroup): void {
  for (const member of group.members) {
    state.membersByWorkspace.set(
      member.workspaceId,
      group.members.filter((candidate) => candidate.workspaceId !== member.workspaceId),
    );
  }
}

function indexGroup(state: WorkspaceGroupState, payload: WorkspaceGroupLookupResult | null): void {
  if (!payload) return;
  state.groups.set(payload.group.id, payload.group);
  reindexGroupMembers(state, payload.group);
}

function removeGroupIndexes(state: WorkspaceGroupState, group: WorkspaceGroup): void {
  state.groups.delete(group.id);
  for (const member of group.members) {
    state.membersByWorkspace.delete(member.workspaceId);
  }
}

function deindexWorkspaceMembership(state: WorkspaceGroupState, workspaceId: string): void {
  state.membersByWorkspace.delete(workspaceId);

  for (const [groupId, group] of state.groups.entries()) {
    if (!group.members.some((member) => member.workspaceId === workspaceId)) {
      continue;
    }

    const nextMembers = group.members.filter((member) => member.workspaceId !== workspaceId);
    if (nextMembers.length <= 1) {
      state.groups.delete(groupId);
      for (const member of nextMembers) {
        state.membersByWorkspace.delete(member.workspaceId);
      }
      return;
    }

    const nextGroup = { ...group, members: nextMembers };
    state.groups.set(groupId, nextGroup);
    reindexGroupMembers(state, nextGroup);
    return;
  }
}

export const useWorkspaceGroupStore = create<WorkspaceGroupState>()(
  immer((set, get) => ({
    groups: new Map(),
    membersByWorkspace: new Map(),

    async loadGroupForWorkspace(workspaceId) {
      const result = await window.api.invoke('workspace-group:get', { workspaceId }) as WorkspaceGroupLookupResult | null;
      set((state) => {
        deindexWorkspaceMembership(state, workspaceId);
        indexGroup(state, result);
      });
    },

    async linkWorkspaces(primaryWorkspaceId, siblingWorkspaceIds) {
      const existing = await window.api.invoke('workspace-group:get', { workspaceId: primaryWorkspaceId }) as WorkspaceGroupLookupResult | null;
      let group: WorkspaceGroup | null = existing?.group ?? null;

      if (!group) {
        group = await window.api.invoke('workspace-group:create', {
          name: 'Linked Workspaces',
          workspaceIds: [primaryWorkspaceId, ...siblingWorkspaceIds],
        }) as WorkspaceGroup;
      } else {
        for (const siblingWorkspaceId of siblingWorkspaceIds) {
          if (!group) {
            break;
          }
          group = await window.api.invoke('workspace-group:add-member', {
            groupId: group.id,
            workspaceId: siblingWorkspaceId,
            role: 'sibling',
          }) as WorkspaceGroup | null;
        }
      }

      const workspaceIds = new Set(group?.members.map((member) => member.workspaceId) ?? [primaryWorkspaceId, ...siblingWorkspaceIds]);
      for (const workspaceId of workspaceIds) {
        await get().loadGroupForWorkspace(workspaceId);
      }
    },

    async unlinkWorkspace(workspaceId) {
      const payload = await window.api.invoke('workspace-group:get', { workspaceId }) as WorkspaceGroupLookupResult | null;
      if (!payload) return;

      const updatedGroup = await window.api.invoke('workspace-group:remove-member', {
        groupId: payload.group.id,
        workspaceId,
      }) as WorkspaceGroup | null;

      set((state) => {
        deindexWorkspaceMembership(state, workspaceId);
        if (!updatedGroup) {
          return;
        }
        removeGroupIndexes(state, payload.group);
      });

      const remainingIds = updatedGroup?.members.map((member) => member.workspaceId) ?? [];
      for (const remainingId of remainingIds) {
        await get().loadGroupForWorkspace(remainingId);
      }
    },

    async dissolveGroup(groupId) {
      const group = get().groups.get(groupId);
      await window.api.invoke('workspace-group:delete', { groupId });
      if (!group) return;
      set((state) => {
        removeGroupIndexes(state, group);
      });
    },

    getSiblingsOf(workspaceId) {
      return get().membersByWorkspace.get(workspaceId) ?? EMPTY_GROUP_MEMBERS;
    },

    removeWorkspace(workspaceId) {
      set((state) => {
        deindexWorkspaceMembership(state, workspaceId);
      });
    },
  })),
);
