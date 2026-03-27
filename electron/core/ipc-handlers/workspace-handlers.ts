import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { AgentId, FileAttachment, SpawnOptions } from '../agents/types';
import type { DiffScope, Workspace, WorkspaceOperation, WorkspaceOutcome, WorkspaceStatus } from '../worktree/types';
import { listWorktrees } from '../worktree/manager';
import { generateWorkspaceName } from '../worktree/names';
import { resolveGitState } from '../worktree/outcome';
import { createWorkspaceFs, createWorktreeAny, removeWorktreeAny } from '../worktree/workspace-fs';
import { getChangedFilesSeparated, getFullDiff, discardFile, discardAll } from '../worktree/diff';
import { logDiagnostic } from '../diagnostics/logger';
import { extendedEnv } from '../process-utils';
import type { IpcContext } from './types';
import { requireFields, commandExists } from './utils';
import * as ops from './operations';
import { wrapWorkspaceActionError } from './operations';

const execFileAsync = promisify(execFile);

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const {
    configManager,
    workspaceStore,
    sendToRenderer,
    lifecycleManager,
    operationManager,
    remoteConnection,
    spawnTaskRun,
    releaseTask,
  } = ctx;

  const startArchive = (workspaceId: string) => {
    const workspace = workspaceStore.get(workspaceId) ?? workspaceStore.getIncludingMissing(workspaceId);
    if (!workspace) {
      // Workspace already gone (e.g. deleted directly from DB) — emit deleted and return
      workspaceStore.delete(workspaceId);
      sendToRenderer('workspace:deleted', { workspaceId });
      logDiagnostic('workspace:archive', 'workspace already missing, cleaned up', { workspaceId });
      const now = Date.now();
      return {
        id: `archive-${workspaceId}-noop`,
        workspaceId,
        kind: 'archive',
        status: 'completed',
        stage: 'cleaning_db',
        progress: 1,
        message: 'Workspace already removed',
        startedAt: now,
        updatedAt: now,
        finishedAt: now,
        cancellable: false,
      } satisfies WorkspaceOperation;
    }

    return operationManager.start({
      workspace,
      kind: 'archive',
      initialMessage: 'Queueing archive',
      run: async ({ signal, update }) => {
        await lifecycleManager.serialized(workspaceId, async () => {
          update({
            stage: 'releasing_tasks',
            progress: 0.12,
            message: 'Stopping workspace tasks',
          });

          const taskIds = lifecycleManager.getActiveTaskIds(workspaceId);
          for (const taskId of taskIds) {
            releaseTask(taskId);
            lifecycleManager.clearTask(taskId);
          }

          if (!workspace.direct) {
            update({
              stage: 'checking_repo',
              progress: 0.22,
              message: 'Checking worktree state',
            });

            await removeWorktreeAny(workspace.sshHost, workspace.parentRepo, workspace.worktreePath, {
              signal,
              onStage: (stage) => update(archiveStageDetails[stage as keyof typeof archiveStageDetails]),
            });
          }

          update({
            stage: 'cleaning_db',
            progress: 0.88,
            message: 'Cleaning workspace records',
            cancellable: false,
          });

          workspaceStore.delete(workspaceId);
          sendToRenderer('workspace:deleted', { workspaceId });
          logDiagnostic('workspace:archive', 'workspace archived', {
            workspaceId,
            parentRepo: workspace.parentRepo,
          });
        });
      },
    });
  };

  ipcMain.handle('workspace:list', async (_event, { parentRepo }: { parentRepo: string }) => {
    // Always return all workspaces — remote ones are stored locally with sshHost set
    return workspaceStore.list(parentRepo);
  });

  ipcMain.handle('workspace:get', async (_event, { workspaceId }: { workspaceId: string }) => {
    return workspaceStore.get(workspaceId);
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
        thinking,
        sshHost,
        outcome,
      }: {
        name: string;
        parentRepo: string;
        branch: string;
        agentId: string;
        model: string;
        mode?: SpawnOptions['mode'];
        thinking?: string;
        sshHost?: string;
        outcome?: import('../worktree/types').WorkspaceOutcome;
      },
    ) => {
      requireFields({ name, parentRepo, branch, agentId, model }, 'name', 'parentRepo', 'branch', 'agentId', 'model');
      const effectiveSshHost = sshHost ?? remoteConnection.host ?? undefined;
      const { worktree, baseBranch } = await createWorktreeAny(effectiveSshHost, parentRepo, branch, branch);

      const ws = workspaceStore.create({
        id: worktree.id,
        name,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        baseBranch,
        agentId,
        model,
        mode,
        thinking: thinking as any,
        sshHost: effectiveSshHost,
        status: 'idle',
        outcome,
      });
      sendToRenderer('workspace:created', { workspace: ws });
      return ws;
    },
  );

  ipcMain.handle(
    'workspace:create-direct',
    async (
      _event,
      {
        name,
        parentRepo,
        agentId,
        model,
        mode,
        thinking,
        sshHost,
        outcome,
      }: {
        name: string;
        parentRepo: string;
        agentId: string;
        model: string;
        mode?: SpawnOptions['mode'];
        thinking?: string;
        sshHost?: string;
        outcome?: import('../worktree/types').WorkspaceOutcome;
      },
    ) => {
      requireFields({ name, parentRepo, agentId, model }, 'name', 'parentRepo', 'agentId', 'model');
      const effectiveSshHost = sshHost ?? remoteConnection.host ?? undefined;
      const wfs = createWorkspaceFs(effectiveSshHost);

      if (!(await wfs.exists(parentRepo))) {
        throw new Error(`Directory "${parentRepo}" does not exist.`);
      }

      // Ensure git is initialized
      try {
        await wfs.git(parentRepo, ['rev-parse', '--git-dir'], { timeout: 5000 });
      } catch {
        await wfs.git(parentRepo, ['init'], { timeout: 10000 });
        await wfs.git(parentRepo, ['commit', '--allow-empty', '-m', 'Initial commit'], { timeout: 10000 });
      }

      // Get current branch
      let currentBranch = 'main';
      try {
        const { stdout } = await wfs.git(parentRepo, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
        currentBranch = stdout.trim() || 'main';
        if (!currentBranch || currentBranch === 'HEAD') {
          const { stdout: symbolicRef } = await wfs.git(parentRepo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
          currentBranch = symbolicRef.trim() || currentBranch || 'main';
        }
      } catch { /* best-effort */ }

      const ws = workspaceStore.create({
        id: crypto.randomUUID(),
        name,
        parentRepo,
        worktreePath: parentRepo,
        branch: currentBranch,
        agentId,
        model,
        mode,
        thinking: thinking as any,
        direct: true,
        sshHost: effectiveSshHost,
        status: 'idle',
        outcome,
      });
      sendToRenderer('workspace:created', { workspace: ws });
      return ws;
    },
  );

  ipcMain.handle(
    'workspace:create-quick',
    async (
      _event,
      { parentRepo, agentId, model, mode, thinking, sshHost }: { parentRepo: string; agentId: string; model: string; mode?: SpawnOptions['mode']; thinking?: string; sshHost?: string },
    ) => {
      requireFields({ parentRepo, agentId, model }, 'parentRepo', 'agentId', 'model');
      const effectiveSshHost = sshHost ?? remoteConnection.host ?? undefined;

      const workspaceName = generateWorkspaceName();
      const branch = `flux/${workspaceName}`;
      const { worktree, baseBranch } = await createWorktreeAny(effectiveSshHost, parentRepo, branch, workspaceName);

      const ws = workspaceStore.create({
        id: worktree.id,
        name: workspaceName,
        parentRepo,
        worktreePath: worktree.path,
        branch: worktree.branch,
        baseBranch,
        agentId,
        model,
        mode,
        thinking: thinking as any,
        sshHost: effectiveSshHost,
        status: 'idle',
      });
      sendToRenderer('workspace:created', { workspace: ws });
      return ws;
    },
  );

  ipcMain.handle(
    'workspace:commit',
    async (_event, { workspaceId, message, files }: { workspaceId: string; message?: string; files?: string[] }) => {
      requireFields({ workspaceId }, 'workspaceId');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      try {
        const wfs = createWorkspaceFs(workspace.sshHost);
        const commitMessage = message || 'checkpoint';

        // Stage selected files or all changes
        if (files && files.length > 0) {
          await wfs.git(workspace.worktreePath, ['add', '--', ...files], { timeout: 15000 });
        } else {
          await wfs.git(workspace.worktreePath, ['add', '-A'], { timeout: 15000 });
        }

        // Check if there's anything to commit
        const { stdout: statusOut } = await wfs.git(workspace.worktreePath, ['status', '--porcelain'], { timeout: 5000 });
        if (!statusOut.trim()) {
          throw new Error('Nothing to commit — working tree is clean');
        }

        // Commit
        await wfs.git(workspace.worktreePath, ['commit', '-m', commitMessage], { timeout: 15000 });

        // Get the new SHA
        const { stdout: shaOut } = await wfs.git(workspace.worktreePath, ['rev-parse', '--short', 'HEAD'], { timeout: 5000 });

        // A manual commit means work is now ready for review in Flux lifecycle terms.
        lifecycleManager.setOutcome(workspaceId, 'ready_for_pr', { force: true });

        return { sha: shaOut.trim(), message: commitMessage };
      } catch (error) {
        throw wrapWorkspaceActionError(workspace, 'commit changes', error);
      }
    },
  );

  ipcMain.handle(
    'workspace:pull-master',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      requireFields({ workspaceId }, 'workspaceId');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const wfs = createWorkspaceFs(workspace.sshHost);
      const targetBranch = workspace.baseBranch || 'master';

      // Fetch latest from remote
      await wfs.git(workspace.worktreePath, ['fetch', 'origin', targetBranch], { timeout: 30000 });

      // Merge origin/<target> into the workspace branch (no rebase to keep history clean)
      const { stdout } = await wfs.git(
        workspace.worktreePath,
        ['merge', `origin/${targetBranch}`, '--no-edit'],
        { timeout: 30000 },
      );

      return { message: stdout.trim() || `Merged origin/${targetBranch} into workspace` };
    },
  );

  ipcMain.handle(
    'workspace:get-commit-subject',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      requireFields({ workspaceId }, 'workspaceId');
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) return null;
      try {
        const wfs = createWorkspaceFs(workspace.sshHost);
        const { stdout } = await wfs.git(workspace.worktreePath, ['log', '-1', '--format=%s'], { timeout: 5000 });
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
      }: { workspaceId: string; newBranch: string; newName?: string },
    ) => {
      requireFields({ workspaceId, newBranch }, 'workspaceId', 'newBranch');
      return ops.renameBranch(ctx, workspaceId, newBranch, newName);
    },
  );

  ipcMain.handle(
    'workspace:spawn',
    async (_event, { taskId: providedTaskId, workspaceId, prompt, mode }: {
      taskId?: string;
      workspaceId: string;
      prompt: string;
      mode?: SpawnOptions['mode'];
    }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      const wfs = createWorkspaceFs(workspace.sshHost);
      if (!(await wfs.exists(workspace.worktreePath))) {
        throw new Error(`Worktree directory does not exist: ${workspace.worktreePath}. The workspace may need to be recreated.`);
      }

      const taskId = providedTaskId ?? crypto.randomUUID();
      const result = await spawnTaskRun({
        taskId,
        workspaceId: workspace.id,
        prompt,
        agentId: workspace.agentId,
        model: workspace.model,
        mode: mode ?? workspace.mode,
        cwd: workspace.worktreePath,
        sessionId: workspace.sessionId,
        sshHost: workspace.sshHost,
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:spawn-chat',
    async (_event, { taskId, workspaceId, prompt, mode, agentId, model, images, attachments }: {
      taskId?: string;
      workspaceId: string;
      prompt: string;
      mode?: SpawnOptions['mode'];
      agentId?: string;
      model?: string;
      images?: string[];
      attachments?: FileAttachment[];
    }) => {
      return ops.spawnWorkspaceChat(ctx, { taskId, workspaceId, prompt, mode, agentId, model, images, attachments });
    },
  );

  ipcMain.handle(
    'workspace:list-chats',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      return ops.listWorkspaceChats(ctx, workspaceId);
    },
  );

  ipcMain.handle('workspace:stop', async (_event, { workspaceId }: { workspaceId: string }) => {
    return ops.stopWorkspace(ctx, workspaceId);
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

      if (!workspace.direct) {
        await removeWorktreeAny(workspace.sshHost, workspace.parentRepo, workspace.worktreePath);
      }
      workspaceStore.delete(workspaceId);
      sendToRenderer('workspace:deleted', { workspaceId });
    });
  });

  ipcMain.handle('workspace:list-operations', async () => {
    return operationManager.list();
  });

  ipcMain.handle('workspace:cancel-operation', async (_event, { operationId }: { operationId: string }) => {
    operationManager.cancel(operationId);
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

      // Serialize per workspace to prevent races with stop/archive/other syncs
      await Promise.all(
        workspaces.map(async (ws) => {
          await lifecycleManager.serialized(ws.id, async () => {
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
            } catch (err) {
              console.error(`[sync-outcomes] Failed for workspace ${ws.id}:`, err);
            }
          });
        }),
      );
    },
  );

  ipcMain.handle(
    'workspace:update',
    async (
      _event,
      {
        workspaceId,
        agentId,
        model,
        mode,
        thinking,
        planAgentId,
        planModel,
        planThinking,
        actAgentId,
        actModel,
        actThinking,
      }: {
        workspaceId: string;
        agentId?: string;
        model?: string;
        mode?: SpawnOptions['mode'];
        thinking?: string;
        planAgentId?: string;
        planModel?: string;
        planThinking?: string;
        actAgentId?: string;
        actModel?: string;
        actThinking?: string;
      },
    ) => {
      workspaceStore.update(workspaceId, {
        ...(agentId ? { agentId: agentId as AgentId } : {}),
        ...(model ? { model } : {}),
        ...(mode ? { mode } : {}),
        ...(thinking ? { thinking: thinking as any } : {}),
        ...(planAgentId ? { planAgentId: planAgentId as AgentId } : {}),
        ...(planModel ? { planModel } : {}),
        ...(planThinking ? { planThinking: planThinking as any } : {}),
        ...(actAgentId ? { actAgentId: actAgentId as AgentId } : {}),
        ...(actModel ? { actModel } : {}),
        ...(actThinking ? { actThinking: actThinking as any } : {}),
      });
    },
  );

  ipcMain.handle('workspace:archive', async (_event, { workspaceId }: { workspaceId: string }) => {
    return { operation: startArchive(workspaceId) };
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
      if (workspace.sshHost) {
        throw new Error(
          `Open this SSH workspace through Remote-SSH instead. Connect to ${workspace.sshHost} `
          + `in VS Code, Cursor, or Zed and open ${workspace.worktreePath}.`,
        );
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
    return ops.diffFiles(ctx, workspaceId);
  });

  ipcMain.handle('workspace:diff-files-separated', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return { staged: [], unstaged: [], committed: [] };
    return getChangedFilesSeparated(workspace.worktreePath, workspace.parentRepo, workspace.sshHost);
  });

  ipcMain.handle(
    'workspace:file-diff',
    async (_event, { workspaceId, filePath, scope }: { workspaceId: string; filePath: string; scope?: DiffScope }) => {
      return ops.fileDiff(ctx, workspaceId, filePath, scope);
    },
  );

  ipcMain.handle(
    'workspace:discard-file',
    async (
      _event,
      { workspaceId, filePath, scope }: { workspaceId: string; filePath: string; scope?: Exclude<DiffScope, 'committed'> },
    ) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) return;
      await discardFile(workspace.worktreePath, filePath, workspace.parentRepo, scope ?? 'all', workspace.sshHost);
    },
  );

  // -----------------------------------------------------------------------
  // Phase 2: Run/Preview from Worktree
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'workspace:detect-scripts',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) return [];

      const scripts: Array<{ name: string; command: string; source: 'package.json' | 'detected' }> = [];

      const wfs = createWorkspaceFs(workspace.sshHost);
      const pkgContent = await wfs.readFile(`${workspace.worktreePath}/package.json`);
      if (pkgContent) {
        try {
          const pkg = JSON.parse(pkgContent);
          if (pkg.scripts) {
            for (const [name] of Object.entries(pkg.scripts)) {
              scripts.push({ name, command: `npm run ${name}`, source: 'package.json' });
            }
          }
        } catch { /* invalid package.json */ }
      }

      const devIndicators = [
        { file: 'vite.config.ts', name: 'Vite Dev', command: 'npx vite' },
        { file: 'vite.config.js', name: 'Vite Dev', command: 'npx vite' },
        { file: 'next.config.js', name: 'Next Dev', command: 'npx next dev' },
        { file: 'next.config.mjs', name: 'Next Dev', command: 'npx next dev' },
        { file: 'next.config.ts', name: 'Next Dev', command: 'npx next dev' },
        { file: 'angular.json', name: 'Angular Serve', command: 'npx ng serve' },
        { file: 'nuxt.config.ts', name: 'Nuxt Dev', command: 'npx nuxi dev' },
      ];
      for (const indicator of devIndicators) {
        if (await wfs.exists(`${workspace.worktreePath}/${indicator.file}`)) {
          const alreadyHas = scripts.some((s) => s.command === indicator.command);
          if (!alreadyHas) {
            scripts.push({ name: indicator.name, command: indicator.command, source: 'detected' });
          }
        }
      }

      return scripts;
    },
  );

  // -----------------------------------------------------------------------
  // Phase 3: Merge & PR Workflow
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'workspace:merge-preview',
    async (_event, { workspaceId, targetBranch }: { workspaceId: string; targetBranch: string }) => {
      return ops.mergePreview(ctx, workspaceId, targetBranch);
    },
  );

  ipcMain.handle(
    'workspace:merge',
    async (_event, { workspaceId }: { workspaceId: string; targetBranch: string; squash?: boolean }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
      throw new Error(`Direct workspace merges are disabled for ${workspace.name}. Start an Agent Merge instead.`);
    },
  );

  ipcMain.handle(
    'workspace:create-pr',
    async (_event, { workspaceId, title, body, targetBranch, draft }: {
      workspaceId: string;
      title: string;
      body: string;
      targetBranch: string;
      draft?: boolean;
    }) => {
      return ops.createPr(ctx, workspaceId, title, body, targetBranch, draft);
    },
  );

  // -----------------------------------------------------------------------
  // Phase 4: Worktree Lifecycle & Hygiene
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'workspace:disk-usage',
    async (_event, { parentRepo }: { parentRepo: string }) => {
      const workspaces = workspaceStore.list(parentRepo);
      const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
      const now = Date.now();

      const results: Array<{
        workspaceId: string;
        name: string;
        branch: string;
        sizeBytes: number;
        lastActivity: number;
        isStale: boolean;
      }> = [];

      for (const ws of workspaces) {
        const wfs = createWorkspaceFs(ws.sshHost);
        const sizeBytes = await wfs.diskUsage(ws.worktreePath);

        const lastActivity = ws.updatedAt || ws.createdAt;
        const isStale = (now - lastActivity) > STALE_THRESHOLD_MS;

        results.push({
          workspaceId: ws.id,
          name: ws.name,
          branch: ws.branch,
          sizeBytes,
          lastActivity,
          isStale,
        });
      }

      return results;
    },
  );

  ipcMain.handle(
    'workspace:prune-stale',
    async (_event, { parentRepo, olderThanDays }: { parentRepo: string; olderThanDays?: number }) => {
      const days = olderThanDays ?? 14;
      const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
      const workspaces = workspaceStore.list(parentRepo);
      const pruned: string[] = [];

      // Only prune orphaned git worktrees for local repos (parentRepo exists on disk)
      if (fs.existsSync(parentRepo)) {
        try {
          const gitWorktrees = await listWorktrees(parentRepo);
          const knownPaths = new Set(workspaceStore.list(parentRepo).map((w) => w.worktreePath));
          for (const wt of gitWorktrees) {
            if (!knownPaths.has(wt.path)) {
              try {
                await removeWorktreeAny(undefined, parentRepo, wt.path);
                pruned.push(`orphan:${wt.branch}`);
              } catch { /* best-effort */ }
            }
          }
        } catch { /* git worktree list failed */ }

        try {
          await execFileAsync('git', ['worktree', 'prune'], { cwd: parentRepo, timeout: 10000 });
        } catch { /* best-effort */ }
      }

      return { pruned };
    },
  );

  // --- Extended workspace operations ---

  ipcMain.handle('workspace:discard-all', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;
    await discardAll(workspace.worktreePath, workspace.sshHost);
  });

  ipcMain.handle('workspace:full-diff', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return null;
    return getFullDiff(workspace.worktreePath, workspace.parentRepo, workspace.sshHost);
  });

  ipcMain.handle('workspace:git-state', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return null;
    return resolveGitState(workspace);
  });

  ipcMain.handle('workspace:active-task', async (_event, { workspaceId }: { workspaceId: string }) => {
    return ops.activeWorkspaceTaskIds(ctx, workspaceId);
  });
}

const archiveStageDetails = {
  checking_repo: {
    stage: 'checking_repo',
    progress: 0.28,
    message: 'Checking git workspace',
  },
  resolving_branch: {
    stage: 'resolving_branch',
    progress: 0.38,
    message: 'Resolving workspace branch',
  },
  removing_git_worktree: {
    stage: 'removing_git_worktree',
    progress: 0.54,
    message: 'Removing git worktree',
  },
  removing_git_branch: {
    stage: 'removing_git_branch',
    progress: 0.68,
    message: 'Removing workspace branch',
  },
  removing_worktree_files: {
    stage: 'removing_worktree_files',
    progress: 0.8,
    message: 'Cleaning workspace files',
  },
} as const;
