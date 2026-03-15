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
import { requireFields, commandExists, moveWorktreeDirectory } from './utils';

const execFileAsync = promisify(execFile);

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const {
    configManager,
    workspaceStore,
    sendToRenderer,
    lifecycleManager,
    getSshHost,
    spawnTaskRun,
    releaseTask,
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
    'workspace:get-commit-subject',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      requireFields({ workspaceId }, 'workspaceId');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
      try {
        const { stdout } = await execFileAsync(
          'git', ['log', '-1', '--format=%s'],
          { cwd: workspace.worktreePath, timeout: 5000 },
        );
        const subject = stdout.trim();
        return subject && !subject.startsWith('[flux]') ? subject : null;
      } catch {
        return null;
      }
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

      let nextWorktreePath = workspace.worktreePath;
      if (newWorktreeName?.trim()) {
        nextWorktreePath = await moveWorktreeDirectory(
          workspace.parentRepo,
          workspace.worktreePath,
          newWorktreeName,
        );
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
    await lifecycleManager.serialized(workspaceId, async () => {
      const taskIds = lifecycleManager.getActiveTaskIds(workspaceId);

      for (const taskId of taskIds) {
        releaseTask(taskId);
        lifecycleManager.clearTask(taskId);
        sendToRenderer('agent:done', { taskId, error: undefined });
      }

      // Sync outcome from git state FIRST so the UI sees consistent state
      const stoppedWs = workspaceStore.get(workspaceId);
      if (stoppedWs) {
        try {
          await lifecycleManager.transitionOutcome(stoppedWs, 'agent_stopped');
        } catch {
          // Best-effort — don't block stop
        }
      }

      // Set status AFTER outcome transition so renderer sees consistent state
      lifecycleManager.setStatus(workspaceId, 'idle');
    });
  });

  ipcMain.handle('workspace:delete', async (_event, { workspaceId }: { workspaceId: string }) => {
    await lifecycleManager.serialized(workspaceId, async () => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) return;

      const taskIds = lifecycleManager.getActiveTaskIds(workspaceId);
      for (const taskId of taskIds) {
        releaseTask(taskId);
        lifecycleManager.clearTask(taskId);
      }

      await removeWorktree(workspace.parentRepo, workspace.worktreePath);
      workspaceStore.delete(workspaceId);
    });
  });

  ipcMain.handle(
    'workspace:set-outcome',
    async (_event, { workspaceId, outcome }: { workspaceId: string; outcome: string }) => {
      lifecycleManager.setOutcome(workspaceId, outcome as WorkspaceOutcome, { force: true });
    },
  );

  // Sync workspace outcomes based on actual git state.  Called after loading
  // workspaces so the UI reflects reality even when merges or changes happened
  // outside Flux (e.g. via CLI, GitHub, or another tool).
  ipcMain.handle(
    'workspace:sync-outcomes',
    async (_event, { parentRepo }: { parentRepo: string }) => {
      const workspaces = workspaceStore.list(parentRepo);

      // Run all checks in parallel for speed
      await Promise.all(
        workspaces.map(async (ws) => {
          // Skip workspaces with active tasks — their outcome will be set on completion
          const hasActiveTask = lifecycleManager.hasActiveTasks(ws.id);
          if (!hasActiveTask) {
            // Reset stale statuses left over from a crashed or force-quit session
            const activeStatuses: WorkspaceStatus[] = ['running', 'merging', 'waiting_approval', 'waiting_input'];
            if (activeStatuses.includes(ws.status as WorkspaceStatus)) {
              const resetStatus = ws.outcome === 'in_progress' ? 'idle' : 'done';
              lifecycleManager.setStatus(ws.id, resetStatus);
            }
          }
          if (hasActiveTask) return;

          try {
            await lifecycleManager.transitionOutcome(ws, 'sync');
          } catch {
            // Best-effort — don't block workspace loading
          }
        }),
      );
    },
  );

  ipcMain.handle(
    'workspace:update',
    async (_event, { workspaceId, agentId, model, mode, thinking }: { workspaceId: string; agentId?: string; model?: string; mode?: SpawnOptions['mode']; thinking?: string }) => {
      workspaceStore.update(workspaceId, {
        ...(agentId ? { agentId: agentId as AgentId } : {}),
        ...(model ? { model } : {}),
        ...(mode ? { mode } : {}),
        ...(thinking ? { thinking: thinking as any } : {}),
      });
    },
  );

  ipcMain.handle('workspace:archive', async (_event, { workspaceId }: { workspaceId: string }) => {
    await lifecycleManager.serialized(workspaceId, async () => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) return;

      const taskIds = lifecycleManager.getActiveTaskIds(workspaceId);
      for (const taskId of taskIds) {
        releaseTask(taskId);
        lifecycleManager.clearTask(taskId);
      }

      // Remove worktree — gracefully handles missing/non-git parentRepo
      try {
        await removeWorktree(workspace.parentRepo, workspace.worktreePath);
      } catch {
        // Worktree may already be gone or parentRepo may not be a git repo
      }

      workspaceStore.archive(workspaceId);
      lifecycleManager.setStatus(workspaceId, 'idle');
    });
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

    // Sync outcome from git state — it may have changed while archived
    try {
      await lifecycleManager.transitionOutcome(restored, 'unarchived');
    } catch {
      // Best-effort
    }

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
