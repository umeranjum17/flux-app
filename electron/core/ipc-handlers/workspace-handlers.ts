import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { AgentId, FileAttachment, SpawnOptions } from '../agents/types';
import type { WorkspaceOutcome, WorkspaceStatus } from '../worktree/types';
import { createWorktree, removeWorktree } from '../worktree/manager';
import { generateWorkspaceName } from '../worktree/names';
import { getChangedFiles, getFileDiff, discardFile } from '../worktree/diff';
import { extendedEnv } from '../process-utils';
import type { IpcContext } from './types';
import { requireFields, commandExists, workspaceHasPendingChanges, isWorkspaceBranchMerged } from './utils';

const execFileAsync = promisify(execFile);

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const {
    configManager,
    workspaceStore,
    sendToRenderer,
    emitWorkspaceStatus,
    emitWorkspaceOutcome,
    activeTasks,
    taskSessions,
    activeSubagents,
    cleaningUp,
    taskIdleHeartbeats,
    taskWorkspaceMap,
    taskWorkspaceStatusMap,
    getSshHost,
    spawnTaskRun,
  } = ctx;

  ipcMain.handle('workspace:list', async (_event, { parentRepo, includeArchived }: { parentRepo: string; includeArchived?: boolean }) => {
    if (getSshHost()) return [];
    return workspaceStore.list(parentRepo, includeArchived);
  });

  ipcMain.handle(
    'workspace:create',
    async (
      _event,
      {
        name,
        parentRepo,
        branch,
        agentId,
        model,
        mode,
      }: {
        name: string;
        parentRepo: string;
        branch: string;
        agentId: string;
        model: string;
        mode?: SpawnOptions['mode'];
      },
    ) => {
      requireFields({ name, parentRepo, branch, agentId, model }, 'name', 'parentRepo', 'branch', 'agentId', 'model');
      if (getSshHost()) {
        throw new Error('Workspaces are only supported for local repositories right now');
      }

      try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
      } catch {
        throw new Error(
          `"${parentRepo}" is not a git repository. Run "git init" in that folder first, then try again.`,
        );
      }

      // Capture the currently checked-out branch so merges default back to it
      let baseBranch: string | undefined;
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: parentRepo, timeout: 5000 });
        baseBranch = stdout.trim() || undefined;
      } catch { /* best-effort */ }

      const worktree = await createWorktree(parentRepo, branch, branch);
      return workspaceStore.create({
        id: worktree.id,
        name,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        baseBranch,
        agentId,
        model,
        mode,
        status: 'idle',
      });
    },
  );

  ipcMain.handle(
    'workspace:create-quick',
    async (
      _event,
      { parentRepo, agentId, model, mode }: { parentRepo: string; agentId: string; model: string; mode?: SpawnOptions['mode'] },
    ) => {
      requireFields({ parentRepo, agentId, model }, 'parentRepo', 'agentId', 'model');
      if (getSshHost()) {
        throw new Error('Workspaces are only supported for local repositories right now');
      }

      try {
        await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
      } catch {
        throw new Error(
          `"${parentRepo}" is not a git repository. Run "git init" in that folder first, then try again.`,
        );
      }

      // Capture the currently checked-out branch so merges default back to it
      let baseBranch: string | undefined;
      try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: parentRepo, timeout: 5000 });
        baseBranch = stdout.trim() || undefined;
      } catch { /* best-effort */ }

      const workspaceName = generateWorkspaceName();
      const branch = `flux/${workspaceName}`;
      const worktree = await createWorktree(parentRepo, branch, workspaceName);
      return workspaceStore.create({
        id: worktree.id,
        name: workspaceName,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        baseBranch,
        agentId,
        model,
        mode,
        status: 'idle',
      });
    },
  );

  ipcMain.handle(
    'workspace:rename-branch',
    async (
      _event,
      {
        workspaceId,
        newBranch,
        newName,
        newWorktreeName,
      }: { workspaceId: string; newBranch: string; newName?: string; newWorktreeName?: string },
    ) => {
      requireFields({ workspaceId, newBranch }, 'workspaceId', 'newBranch');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const trimmedName = newName?.trim();
      const trimmedWorktreeName = newWorktreeName
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);

      let nextWorktreePath = workspace.worktreePath;
      if (trimmedWorktreeName) {
        const worktreeDir = path.dirname(workspace.worktreePath);
        let candidatePath = path.join(worktreeDir, trimmedWorktreeName);
        if (candidatePath !== workspace.worktreePath && fs.existsSync(candidatePath)) {
          for (let i = 2; i <= 999; i += 1) {
            const suffix = `-${i}`;
            const base = trimmedWorktreeName.slice(0, Math.max(1, 64 - suffix.length));
            const candidate = path.join(worktreeDir, `${base}${suffix}`);
            if (!fs.existsSync(candidate)) {
              candidatePath = candidate;
              break;
            }
          }
        }
        if (candidatePath !== workspace.worktreePath) {
          try {
            await execFileAsync('git', ['worktree', 'move', workspace.worktreePath, candidatePath], {
              cwd: workspace.parentRepo,
              timeout: 30000,
            });
            nextWorktreePath = candidatePath;
          } catch (error) {
            console.warn('[workspace:rename-branch] failed to move worktree path', error);
          }
        }
      }

      let nextBranch = workspace.branch;
      if (newBranch.trim() && newBranch !== workspace.branch) {
        try {
          await execFileAsync('git', ['branch', '-m', workspace.branch, newBranch], {
            cwd: nextWorktreePath,
            timeout: 10000,
          });
          nextBranch = newBranch;
        } catch (error) {
          console.warn('[workspace:rename-branch] failed to rename branch', error);
        }
      }

      const updated = workspaceStore.update(workspaceId, {
        branch: nextBranch,
        worktreePath: nextWorktreePath,
        ...(trimmedName ? { name: trimmedName } : {}),
      });
      if (!updated) throw new Error(`Workspace ${workspaceId} not found`);
      return updated;
    },
  );

  ipcMain.handle(
    'workspace:spawn',
    async (_event, { workspaceId, prompt, mode }: { workspaceId: string; prompt: string; mode?: SpawnOptions['mode'] }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const taskId = crypto.randomUUID();
      const result = await spawnTaskRun({
        taskId,
        workspaceId: workspace.id,
        prompt,
        agentId: workspace.agentId,
        model: workspace.model,
        mode: mode ?? workspace.mode,
        cwd: workspace.worktreePath,
        sessionId: workspace.sessionId,
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:spawn-chat',
    async (_event, { workspaceId, prompt, mode, agentId: overrideAgentId, model: overrideModel, images, attachments }: {
      workspaceId: string;
      prompt: string;
      mode?: SpawnOptions['mode'];
      agentId?: string;
      model?: string;
      images?: string[];
      attachments?: FileAttachment[];
    }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const taskId = crypto.randomUUID();
      const result = await spawnTaskRun({
        taskId,
        workspaceId: workspace.id,
        prompt,
        agentId: (overrideAgentId ?? workspace.agentId) as any,
        model: overrideModel ?? workspace.model,
        mode: mode ?? workspace.mode,
        cwd: workspace.worktreePath,
        images,
        attachments,
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:list-chats',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      return workspaceStore.listSessions(workspaceId);
    },
  );

  ipcMain.handle('workspace:stop', async (_event, { workspaceId }: { workspaceId: string }) => {
    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      if (cleaningUp.has(taskId)) continue;
      cleaningUp.add(taskId);
      for (const [subId, sub] of activeSubagents.entries()) {
        if (sub.parentTaskId !== taskId) continue;
        await sub.handle.stop();
        sub.handle.removeAllListeners();
        activeSubagents.delete(subId);
        activeTasks.delete(subId);
        taskSessions.delete(subId);
      }
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      if (taskIdleHeartbeats.has(taskId)) {
        clearInterval(taskIdleHeartbeats.get(taskId)!);
        taskIdleHeartbeats.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
      cleaningUp.delete(taskId);
      sendToRenderer('agent:done', { taskId, error: undefined });
    }

    emitWorkspaceStatus(workspaceId, 'idle');
  });

  ipcMain.handle('workspace:delete', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
    }

    await removeWorktree(workspace.parentRepo, workspace.worktreePath);
    workspaceStore.delete(workspaceId);
  });

  ipcMain.handle(
    'workspace:set-outcome',
    async (_event, { workspaceId, outcome }: { workspaceId: string; outcome: string }) => {
      emitWorkspaceOutcome(workspaceId, outcome as WorkspaceOutcome);
    },
  );

  // Sync workspace outcomes based on actual git state.  Called after loading
  // workspaces so the UI reflects reality even when merges or changes happened
  // outside Flux (e.g. via CLI, GitHub, or another tool).
  ipcMain.handle(
    'workspace:sync-outcomes',
    async (_event, { parentRepo }: { parentRepo: string }) => {
      const workspaces = workspaceStore.list(parentRepo);
      const userPromoted = new Set<WorkspaceOutcome>(['ready_to_merge', 'ready_to_archive']);

      // Run all checks in parallel for speed
      await Promise.all(
        workspaces.map(async (ws) => {
          // Skip workspaces with active tasks — their outcome will be set on completion
          const hasActiveTask = [...taskWorkspaceMap.entries()].some(([, wsId]) => wsId === ws.id);
          if (!hasActiveTask) {
            // Reset stale statuses left over from a crashed or force-quit session
            const activeStatuses: WorkspaceStatus[] = ['running', 'merging', 'waiting_approval', 'waiting_input'];
            if (activeStatuses.includes(ws.status as WorkspaceStatus)) {
              const resetStatus = ws.outcome === 'in_progress' ? 'idle' : 'done';
              emitWorkspaceStatus(ws.id, resetStatus);
            }
          }
          if (hasActiveTask) return;

          try {
            if (ws.outcome === 'merged') {
              // Already merged — nothing to do
              return;
            }

            // Check if the branch has been merged externally
            const merged = await isWorkspaceBranchMerged(ws);
            if (merged) {
              emitWorkspaceOutcome(ws.id, 'merged');
              return;
            }

            // For non-promoted outcomes, check pending changes
            if (!userPromoted.has(ws.outcome)) {
              const { hasPendingChanges } = await workspaceHasPendingChanges(ws);
              if (hasPendingChanges && ws.outcome === 'in_progress') {
                emitWorkspaceOutcome(ws.id, 'ready_for_pr');
              } else if (!hasPendingChanges && ws.outcome === 'ready_for_pr') {
                // Changes were reverted or reset — go back to in_progress
                emitWorkspaceOutcome(ws.id, 'in_progress');
              }
            }
          } catch {
            // Best-effort — don't block workspace loading
          }
        }),
      );
    },
  );

  ipcMain.handle(
    'workspace:update',
    async (_event, { workspaceId, agentId, model, mode }: { workspaceId: string; agentId?: string; model?: string; mode?: SpawnOptions['mode'] }) => {
      workspaceStore.update(workspaceId, {
        ...(agentId ? { agentId: agentId as AgentId } : {}),
        ...(model ? { model } : {}),
        ...(mode ? { mode } : {}),
      });
    },
  );

  ipcMain.handle('workspace:archive', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const taskIds = [...taskWorkspaceMap.entries()]
      .filter(([, wsId]) => wsId === workspaceId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      const handle = activeTasks.get(taskId);
      if (handle) {
        handle.stop();
        handle.removeAllListeners();
        activeTasks.delete(taskId);
      }
      taskSessions.delete(taskId);
      taskWorkspaceStatusMap.delete(taskId);
      taskWorkspaceMap.delete(taskId);
    }

    // Remove worktree — gracefully handles missing/non-git parentRepo
    try {
      await removeWorktree(workspace.parentRepo, workspace.worktreePath);
    } catch {
      // Worktree may already be gone or parentRepo may not be a git repo
    }

    workspaceStore.archive(workspaceId);
    emitWorkspaceStatus(workspaceId, 'idle');
  });

  ipcMain.handle('workspace:unarchive', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    await execFileAsync('git', ['worktree', 'add', workspace.worktreePath, workspace.branch], {
      cwd: workspace.parentRepo,
      timeout: 30000,
    });

    const restored = workspaceStore.unarchive(workspaceId);
    if (!restored) throw new Error('Failed to unarchive workspace');
    return restored;
  });

  ipcMain.handle(
    'workspace:open-ide',
    async (
      _event,
      {
        workspaceId,
        ide,
      }: {
        workspaceId: string;
        ide?: 'code' | 'cursor' | 'zed';
      },
    ) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const configured = configManager.get().preferredIde;
      const preferred = ide ?? configured ?? 'code';
      const ordered: Array<'code' | 'cursor' | 'zed'> = [
        preferred,
        ...(['code', 'cursor', 'zed'] as const).filter((candidate) => candidate !== preferred),
      ];

      let selected: 'code' | 'cursor' | 'zed' | null = null;
      for (const candidate of ordered) {
        if (await commandExists(candidate)) {
          selected = candidate;
          break;
        }
      }

      if (!selected) {
        throw new Error('No supported IDE command found on PATH (code, cursor, zed)');
      }

      await execFileAsync(selected, ['--new-window', workspace.worktreePath], {
        cwd: workspace.worktreePath,
        timeout: 10000,
        env: extendedEnv(),
      });
      return { ide: selected };
    },
  );

  ipcMain.handle('workspace:diff-files', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    const files = await getChangedFiles(workspace.worktreePath, workspace.parentRepo);
    return files;
  });

  ipcMain.handle(
    'workspace:file-diff',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      return getFileDiff(workspace.worktreePath, filePath, workspace.parentRepo);
    },
  );

  ipcMain.handle(
    'workspace:discard-file',
    async (_event, { workspaceId, filePath }: { workspaceId: string; filePath: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }
      await discardFile(workspace.worktreePath, filePath, workspace.parentRepo);
    },
  );
}
