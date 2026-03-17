import { ipcMain } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as pty from 'node-pty';

import type { AgentId, FileAttachment, SpawnOptions } from '../agents/types';
import type { WorkspaceOutcome, WorkspaceStatus } from '../worktree/types';
import { createWorktree, removeWorktree, listWorktrees } from '../worktree/manager';
import { generateWorkspaceName } from '../worktree/names';
import { getChangedFiles, getFileDiff, discardFile, discardAll, getFullDiff } from '../worktree/diff';
import { resolveGitState } from '../worktree/outcome';
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
      }: {
        name: string;
        parentRepo: string;
        branch: string;
        agentId: string;
        model: string;
        mode?: SpawnOptions['mode'];
        thinking?: string;
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
        status: 'idle',
      });
      sendToRenderer('workspace:created', { workspace: ws });
      return ws;
    },
  );

  ipcMain.handle(
    'workspace:create-quick',
    async (
      _event,
      { parentRepo, agentId, model, mode, thinking }: { parentRepo: string; agentId: string; model: string; mode?: SpawnOptions['mode']; thinking?: string },
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
        status: 'idle',
      });
      sendToRenderer('workspace:created', { workspace: ws });
      return ws;
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
      });
      return { taskId, session: result.session };
    },
  );

  ipcMain.handle(
    'workspace:spawn-chat',
    async (_event, { taskId: providedTaskId, workspaceId, prompt, mode, agentId: overrideAgentId, model: overrideModel, images, attachments }: {
      taskId?: string;
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

      const taskId = providedTaskId ?? crypto.randomUUID();
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
      sendToRenderer('workspace:deleted', { workspaceId });
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
      sendToRenderer('workspace:archived', { workspaceId });
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

  // -----------------------------------------------------------------------
  // Phase 2: Run/Preview from Worktree
  // -----------------------------------------------------------------------

  const activeRunProcesses = new Map<string, pty.IPty>();

  ipcMain.handle(
    'workspace:detect-scripts',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const scripts: Array<{ name: string; command: string; source: 'package.json' | 'detected' }> = [];

      // Check package.json
      const pkgPath = path.join(workspace.worktreePath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.scripts) {
            for (const [name, cmd] of Object.entries(pkg.scripts)) {
              scripts.push({ name, command: `npm run ${name}`, source: 'package.json' });
            }
          }
        } catch { /* invalid package.json */ }
      }

      // Check for common dev server patterns
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
        if (fs.existsSync(path.join(workspace.worktreePath, indicator.file))) {
          const alreadyHas = scripts.some((s) => s.command === indicator.command);
          if (!alreadyHas) {
            scripts.push({ name: indicator.name, command: indicator.command, source: 'detected' });
          }
        }
      }

      return scripts;
    },
  );

  ipcMain.handle(
    'workspace:run-command',
    async (_event, { workspaceId, command }: { workspaceId: string; command: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const terminalId = `run-${crypto.randomUUID().slice(0, 8)}`;

      let shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      if (process.platform !== 'win32') {
        const preferred = process.env.SHELL;
        if (preferred && fs.existsSync(preferred)) {
          shell = preferred;
        }
      }

      const ptyProcess = pty.spawn(shell, ['-c', command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workspace.worktreePath,
        env: extendedEnv({ TERM: 'xterm-256color' }) as Record<string, string>,
      });

      activeRunProcesses.set(terminalId, ptyProcess);

      ptyProcess.onData((data: string) => {
        sendToRenderer('workspace:run-output', { workspaceId, terminalId, data });
      });

      ptyProcess.onExit(({ exitCode }) => {
        activeRunProcesses.delete(terminalId);
        sendToRenderer('workspace:run-exit', { workspaceId, terminalId, exitCode });
      });

      return { terminalId };
    },
  );

  ipcMain.handle('workspace:stop-run', async (_event, { terminalId }: { terminalId: string }) => {
    const proc = activeRunProcesses.get(terminalId);
    if (proc) {
      proc.kill();
      activeRunProcesses.delete(terminalId);
    }
  });

  // -----------------------------------------------------------------------
  // Phase 3: Merge & PR Workflow
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'workspace:merge-preview',
    async (_event, { workspaceId, targetBranch }: { workspaceId: string; targetBranch: string }) => {
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const worktreePath = workspace.worktreePath;
      const parentRepo = workspace.parentRepo;

      // Get merge base
      let mergeBase: string;
      try {
        const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', targetBranch], {
          cwd: worktreePath,
          timeout: 10000,
        });
        mergeBase = stdout.trim();
      } catch {
        // No common ancestor — full diff
        mergeBase = '';
      }

      // Commits ahead
      let commitsAhead = 0;
      if (mergeBase) {
        try {
          const { stdout } = await execFileAsync('git', ['rev-list', '--count', `${mergeBase}..HEAD`], {
            cwd: worktreePath,
            timeout: 10000,
          });
          commitsAhead = parseInt(stdout.trim(), 10) || 0;
        } catch { /* fallback */ }
      }

      // Files changed + additions/deletions
      let filesChanged = 0;
      let additions = 0;
      let deletions = 0;
      try {
        const diffRef = mergeBase || targetBranch;
        const { stdout } = await execFileAsync(
          'git', ['diff', '--stat', '--numstat', diffRef],
          { cwd: worktreePath, timeout: 30000 },
        );
        for (const line of stdout.trim().split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            filesChanged++;
            const a = parseInt(parts[0], 10);
            const d = parseInt(parts[1], 10);
            if (!isNaN(a)) additions += a;
            if (!isNaN(d)) deletions += d;
          }
        }
      } catch { /* fallback */ }

      // Check for conflicts (dry-run merge)
      const conflicts: string[] = [];
      let canFastForward = false;
      try {
        // Check if fast-forward is possible
        const { stdout: ffCheck } = await execFileAsync(
          'git', ['merge-base', '--is-ancestor', targetBranch, 'HEAD'],
          { cwd: worktreePath, timeout: 10000 },
        );
        canFastForward = true;
      } catch {
        // Not a fast-forward, check for conflicts via merge-tree
        try {
          const branch = workspace.branch;
          const { stdout: mergeTree } = await execFileAsync(
            'git', ['merge-tree', '--write-tree', '--no-messages', targetBranch, branch],
            { cwd: parentRepo, timeout: 30000 },
          );
          // If merge-tree succeeds, no conflicts
        } catch (err: any) {
          // merge-tree exits non-zero on conflicts, parse stderr
          if (err.stderr) {
            const lines = (err.stderr as string).split('\n');
            for (const line of lines) {
              if (line.includes('CONFLICT')) {
                const match = line.match(/CONFLICT.*?: (.+)/);
                if (match) conflicts.push(match[1]);
              }
            }
          }
        }
      }

      return { commitsAhead, filesChanged, additions, deletions, conflicts, canFastForward };
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
      const workspace = workspaceStore.get(workspaceId);
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      // Push branch to remote first
      try {
        await execFileAsync('git', ['push', '-u', 'origin', workspace.branch], {
          cwd: workspace.worktreePath,
          timeout: 60000,
          env: extendedEnv(),
        });
      } catch (err: any) {
        throw new Error(`Failed to push branch: ${err.message}`);
      }

      // Create PR via gh CLI
      const ghArgs = ['pr', 'create',
        '--title', title,
        '--body', body,
        '--base', targetBranch,
        '--head', workspace.branch,
      ];
      if (draft) ghArgs.push('--draft');

      try {
        const { stdout } = await execFileAsync('gh', ghArgs, {
          cwd: workspace.parentRepo,
          timeout: 30000,
          env: extendedEnv(),
        });

        // Parse PR URL from gh output
        const url = stdout.trim();
        const prNumberMatch = url.match(/\/pull\/(\d+)/);
        const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

        lifecycleManager.setOutcome(workspaceId, 'ready_to_merge', { force: true });

        return { url, number };
      } catch (err: any) {
        throw new Error(`Failed to create PR: ${err.message}`);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Phase 4: Worktree Lifecycle & Hygiene
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'workspace:disk-usage',
    async (_event, { parentRepo }: { parentRepo: string }) => {
      const workspaces = workspaceStore.list(parentRepo, true);
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
        let sizeBytes = 0;
        if (fs.existsSync(ws.worktreePath)) {
          try {
            const { stdout } = await execFileAsync('du', ['-sk', ws.worktreePath], { timeout: 10000 });
            sizeBytes = (parseInt(stdout.split('\t')[0], 10) || 0) * 1024;
          } catch { /* fallback: unknown size */ }
        }

        const lastActivity = ws.updatedAt || ws.createdAt;
        const isStale = (now - lastActivity) > STALE_THRESHOLD_MS && !ws.archivedAt;

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

      // Also prune orphaned git worktrees that aren't tracked in our DB
      try {
        const gitWorktrees = await listWorktrees(parentRepo);
        const knownPaths = new Set(workspaceStore.list(parentRepo, true).map((w) => w.worktreePath));
        for (const wt of gitWorktrees) {
          if (!knownPaths.has(wt.path)) {
            // Orphaned worktree — not in DB
            try {
              await removeWorktree(parentRepo, wt.path);
              pruned.push(`orphan:${wt.branch}`);
            } catch { /* best-effort */ }
          }
        }
      } catch { /* git worktree list failed */ }

      // Prune stale archived workspaces with no recent activity
      for (const ws of workspaces) {
        if (ws.archivedAt && ws.updatedAt < threshold) {
          try {
            await removeWorktree(ws.parentRepo, ws.worktreePath);
            workspaceStore.delete(ws.id);
            pruned.push(ws.name);
          } catch { /* best-effort */ }
        }
      }

      // Git worktree prune to clean up dead references
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: parentRepo, timeout: 10000 });
      } catch { /* best-effort */ }

      return { pruned };
    },
  );

  // --- Extended workspace operations ---

  ipcMain.handle('workspace:discard-all', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    await discardAll(workspace.worktreePath);
  });

  ipcMain.handle('workspace:full-diff', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return getFullDiff(workspace.worktreePath, workspace.parentRepo);
  });

  ipcMain.handle('workspace:git-state', async (_event, { workspaceId }: { workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    return resolveGitState(workspace);
  });

  ipcMain.handle('workspace:active-task', async (_event, { workspaceId }: { workspaceId: string }) => {
    return lifecycleManager.getActiveTaskIds(workspaceId);
  });
}
