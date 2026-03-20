import { ipcMain } from 'electron';
import { ProjectGroupStore } from '../project-group/store';
import type { WorkspaceStore } from '../worktree/store';

export function registerProjectGroupHandlers(opts: {
  projectGroupStore: ProjectGroupStore;
  workspaceStore: WorkspaceStore;
}): void {
  const { projectGroupStore, workspaceStore } = opts;

  ipcMain.handle(
    'project-group:create',
    async (_event, { name, projects }: { name: string; projects?: string[] }) => {
      return projectGroupStore.create(name, projects);
    },
  );

  ipcMain.handle('project-group:list', async () => {
    return projectGroupStore.list();
  });

  ipcMain.handle('project-group:get', async (_event, { id }: { id: string }) => {
    return projectGroupStore.get(id);
  });

  ipcMain.handle(
    'project-group:add-project',
    async (_event, { groupId, projectPath }: { groupId: string; projectPath: string }) => {
      return projectGroupStore.addProject(groupId, projectPath);
    },
  );

  ipcMain.handle(
    'project-group:remove-project',
    async (_event, { groupId, projectPath }: { groupId: string; projectPath: string }) => {
      return projectGroupStore.removeProject(groupId, projectPath);
    },
  );

  ipcMain.handle(
    'project-group:rename',
    async (_event, { groupId, name }: { groupId: string; name: string }) => {
      return projectGroupStore.rename(groupId, name);
    },
  );

  ipcMain.handle('project-group:delete', async (_event, { groupId }: { groupId: string }) => {
    projectGroupStore.delete(groupId);
  });

  ipcMain.handle(
    'workspace:list-multi',
    async (_event, { parentRepos }: { parentRepos: string[] }) => {
      const normalizedRepos = [...new Set(parentRepos.map((r) => r.trim()).filter(Boolean))];
      if (normalizedRepos.length === 0) {
        return workspaceStore.list();
      }
      const results = [];
      for (const repo of normalizedRepos) {
        results.push(...workspaceStore.list(repo));
      }
      return results.length > 0 ? results : workspaceStore.list();
    },
  );
}
