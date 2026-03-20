import { ipcMain } from 'electron';
import { WorkspaceGroupStore } from '../workspace-group/store';

export function registerWorkspaceGroupHandlers(opts: {
  workspaceGroupStore: WorkspaceGroupStore;
}): void {
  const { workspaceGroupStore } = opts;

  ipcMain.handle(
    'workspace-group:create',
    async (_event, { name, workspaceIds }: { name: string; workspaceIds?: string[] }) => {
      return workspaceGroupStore.create(name, workspaceIds);
    },
  );

  ipcMain.handle('workspace-group:get', async (_event, { workspaceId }: { workspaceId: string }) => {
    return workspaceGroupStore.getGroupForWorkspace(workspaceId);
  });

  ipcMain.handle('workspace-group:list-members', async (_event, { groupId }: { groupId: string }) => {
    return workspaceGroupStore.listMembers(groupId);
  });

  ipcMain.handle(
    'workspace-group:add-member',
    async (
      _event,
      { groupId, workspaceId, role }: { groupId: string; workspaceId: string; role?: 'primary' | 'sibling' },
    ) => {
      return workspaceGroupStore.addMember(groupId, workspaceId, role);
    },
  );

  ipcMain.handle(
    'workspace-group:remove-member',
    async (_event, { groupId, workspaceId }: { groupId: string; workspaceId: string }) => {
      return workspaceGroupStore.removeMember(groupId, workspaceId);
    },
  );

  ipcMain.handle('workspace-group:delete', async (_event, { groupId }: { groupId: string }) => {
    workspaceGroupStore.delete(groupId);
  });
}
