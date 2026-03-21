/**
 * Remote control service — thin transport adapter over shared operations.
 *
 * Every method delegates to the canonical handler in `operations.ts` so the
 * remote (WebSocket) path and the IPC (Electron renderer) path share the
 * exact same orchestration logic.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

import type { DiffScope, WorkspaceOutcome } from '../worktree/types';
import type { SpawnOptions } from '../agents/types';
import type { IpcContext } from '../ipc-handlers/types';
import { createWorktree, removeWorktree } from '../worktree/manager';
import { generateWorkspaceName } from '../worktree/names';
import { extendedEnv } from '../process-utils';
import {
  detectAgents,
  getActiveTasks,
  approveTask,
  denyTask,
  answerTaskQuestion,
  steerTask,
  stopWorkspace,
  spawnWorkspaceChat,
  listWorkspaceChats,
  activeWorkspaceTaskIds,
  listMulti,
  diffFiles,
  fileDiff,
  getSession,
  sessionMessages,
} from '../ipc-handlers/operations';

const execFileAsync = promisify(execFile);

export class RemoteControlService {
  constructor(private readonly ctx: IpcContext) {}

  async detectAgents() {
    return detectAgents();
  }

  async activeTasks() {
    return getActiveTasks(this.ctx);
  }

  async listMulti(parentRepos: string[]) {
    return listMulti(this.ctx, parentRepos);
  }

  async activeWorkspaceTaskIds(workspaceId: string) {
    return activeWorkspaceTaskIds(this.ctx, workspaceId);
  }

  async listWorkspaceChats(workspaceId: string) {
    return listWorkspaceChats(this.ctx, workspaceId);
  }

  async getSession(id: string) {
    return getSession(this.ctx, id);
  }

  async sessionMessages(id: string) {
    return sessionMessages(this.ctx, id);
  }

  async spawnWorkspaceChat(input: {
    taskId?: string;
    workspaceId: string;
    prompt: string;
    mode?: 'plan' | 'act' | 'ask' | 'architect';
    agentId?: string;
    model?: string;
    images?: string[];
    attachments?: Array<{ path: string; name: string }>;
  }) {
    return spawnWorkspaceChat(this.ctx, input);
  }

  async stopWorkspace(workspaceId: string): Promise<void> {
    return stopWorkspace(this.ctx, workspaceId);
  }

  async diffFiles(workspaceId: string) {
    return diffFiles(this.ctx, workspaceId);
  }

  async fileDiff(workspaceId: string, filePath: string, scope?: DiffScope) {
    return fileDiff(this.ctx, workspaceId, filePath, scope);
  }

  approveTask(taskId: string, requestId: string): void {
    approveTask(this.ctx, taskId, requestId);
  }

  denyTask(taskId: string, requestId: string): void {
    denyTask(this.ctx, taskId, requestId);
  }

  answerTaskQuestion(taskId: string, requestId: string, response: string): void {
    answerTaskQuestion(this.ctx, taskId, requestId, response);
  }

  async steerTask(taskId: string, prompt: string, images?: string[], attachments?: Array<{ path: string; name: string }>) {
    return steerTask(this.ctx, taskId, prompt, images, attachments);
  }

  async getConfig() {
    return this.ctx.configManager.get();
  }

  async createWorkspace(input: {
    name: string;
    parentRepo: string;
    branch: string;
    agentId: string;
    model: string;
    mode?: SpawnOptions['mode'];
    thinking?: string;
  }) {
    const { name, parentRepo, branch, agentId, model, mode, thinking } = input;
    if (this.ctx.getSshHost()) {
      throw new Error('Workspaces are only supported for local repositories right now');
    }

    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
    } catch {
      if (!fs.existsSync(parentRepo)) {
        throw new Error(`Directory "${parentRepo}" does not exist.`);
      }
      await execFileAsync('git', ['init'], { cwd: parentRepo, timeout: 10000 });
      await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: parentRepo, timeout: 10000 });
    }

    let baseBranch: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: parentRepo, timeout: 5000 });
      baseBranch = stdout.trim() || undefined;
    } catch { /* best-effort */ }

    const worktree = await createWorktree(parentRepo, branch, branch);
    const ws = this.ctx.workspaceStore.create({
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
    this.ctx.sendToRenderer('workspace:created', { workspace: ws });
    return ws;
  }

  async createQuickWorkspace(input: {
    parentRepo: string;
    agentId: string;
    model: string;
    mode?: SpawnOptions['mode'];
    thinking?: string;
  }) {
    const { parentRepo, agentId, model, mode, thinking } = input;
    if (this.ctx.getSshHost()) {
      throw new Error('Workspaces are only supported for local repositories right now');
    }
    if (!fs.existsSync(parentRepo)) {
      throw new Error(`Directory "${parentRepo}" does not exist.`);
    }

    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: parentRepo, timeout: 5000 });
    } catch {
      await execFileAsync('git', ['init'], { cwd: parentRepo, timeout: 10000 });
      await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: parentRepo, timeout: 10000 });
    }

    let baseBranch: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: parentRepo, timeout: 5000 });
      baseBranch = stdout.trim() || undefined;
    } catch { /* best-effort */ }

    const workspaceName = generateWorkspaceName();
    const branch = `flux/${workspaceName}`;
    const worktree = await createWorktree(parentRepo, branch, workspaceName);
    const ws = this.ctx.workspaceStore.create({
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
    this.ctx.sendToRenderer('workspace:created', { workspace: ws });
    return ws;
  }

  async deleteWorkspace(workspaceId: string) {
    const { workspaceStore, lifecycleManager, sendToRenderer, releaseTask } = this.ctx;
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
  }

  async archiveWorkspace(workspaceId: string) {
    const { workspaceStore, operationManager, lifecycleManager, sendToRenderer, releaseTask } = this.ctx;
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    return {
      operation: operationManager.start({
        workspace,
        kind: 'archive',
        initialMessage: 'Queueing archive',
        run: async ({ signal, update }) => {
          await lifecycleManager.serialized(workspaceId, async () => {
            update({ stage: 'releasing_tasks', progress: 0.12, message: 'Stopping workspace tasks' });
            const taskIds = lifecycleManager.getActiveTaskIds(workspaceId);
            for (const taskId of taskIds) {
              releaseTask(taskId);
              lifecycleManager.clearTask(taskId);
            }
            update({ stage: 'checking_repo', progress: 0.22, message: 'Checking worktree state' });
            await removeWorktree(workspace.parentRepo, workspace.worktreePath, { signal });
            update({ stage: 'cleaning_db', progress: 0.88, message: 'Cleaning workspace records', cancellable: false });
            workspaceStore.delete(workspaceId);
            sendToRenderer('workspace:deleted', { workspaceId });
          });
        },
      }),
    };
  }

  async renameBranch(workspaceId: string, newBranch: string, newName?: string) {
    const workspace = this.ctx.workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const trimmedName = newName?.trim();
    let nextBranch = workspace.branch;
    if (newBranch.trim() && newBranch !== workspace.branch) {
      try {
        await execFileAsync('git', ['branch', '-m', workspace.branch, newBranch], {
          cwd: workspace.worktreePath,
          timeout: 10000,
        });
        nextBranch = newBranch;
      } catch { /* best-effort */ }
    }

    const updated = this.ctx.workspaceStore.update(workspaceId, {
      branch: nextBranch,
      ...(trimmedName ? { name: trimmedName } : {}),
    });
    if (!updated) throw new Error(`Workspace ${workspaceId} not found`);
    return updated;
  }

  async setOutcome(workspaceId: string, outcome: WorkspaceOutcome) {
    this.ctx.lifecycleManager.setOutcome(workspaceId, outcome, { force: true });
  }

  async updateWorkspace(workspaceId: string, partial: Record<string, unknown>) {
    const fields: Record<string, unknown> = {};
    for (const key of ['agentId', 'model', 'mode', 'thinking', 'planAgentId', 'planModel', 'planThinking', 'actAgentId', 'actModel', 'actThinking']) {
      if (partial[key]) fields[key] = partial[key];
    }
    this.ctx.workspaceStore.update(workspaceId, fields);
  }

  async mergePreview(workspaceId: string, targetBranch: string) {
    const workspace = this.ctx.workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const worktreePath = workspace.worktreePath;
    const parentRepo = workspace.parentRepo;

    let mergeBase = '';
    try {
      const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', targetBranch], { cwd: worktreePath, timeout: 10000 });
      mergeBase = stdout.trim();
    } catch { /* no common ancestor */ }

    let commitsAhead = 0;
    if (mergeBase) {
      try {
        const { stdout } = await execFileAsync('git', ['rev-list', '--count', `${mergeBase}..HEAD`], { cwd: worktreePath, timeout: 10000 });
        commitsAhead = parseInt(stdout.trim(), 10) || 0;
      } catch { /* fallback */ }
    }

    let filesChanged = 0, additions = 0, deletions = 0;
    try {
      const diffRef = mergeBase || targetBranch;
      const { stdout } = await execFileAsync('git', ['diff', '--stat', '--numstat', diffRef], { cwd: worktreePath, timeout: 30000 });
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

    const conflicts: string[] = [];
    let canFastForward = false;
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', targetBranch, 'HEAD'], { cwd: worktreePath, timeout: 10000 });
      canFastForward = true;
    } catch {
      try {
        await execFileAsync('git', ['merge-tree', '--write-tree', '--no-messages', targetBranch, workspace.branch], { cwd: parentRepo, timeout: 30000 });
      } catch (err: any) {
        if (err.stderr) {
          for (const line of (err.stderr as string).split('\n')) {
            if (line.includes('CONFLICT')) {
              const match = line.match(/CONFLICT.*?: (.+)/);
              if (match) conflicts.push(match[1]);
            }
          }
        }
      }
    }

    return { commitsAhead, filesChanged, additions, deletions, conflicts, canFastForward };
  }

  async createPr(workspaceId: string, title: string, body: string, targetBranch: string, draft?: boolean) {
    const workspace = this.ctx.workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    try {
      await execFileAsync('git', ['push', '-u', 'origin', workspace.branch], {
        cwd: workspace.worktreePath,
        timeout: 60000,
        env: extendedEnv(),
      });
    } catch (err: any) {
      throw new Error(`Failed to push branch: ${err.message}`);
    }

    const ghArgs = ['pr', 'create', '--title', title, '--body', body, '--base', targetBranch, '--head', workspace.branch];
    if (draft) ghArgs.push('--draft');

    try {
      const { stdout } = await execFileAsync('gh', ghArgs, {
        cwd: workspace.parentRepo,
        timeout: 30000,
        env: extendedEnv(),
      });
      const url = stdout.trim();
      const prNumberMatch = url.match(/\/pull\/(\d+)/);
      const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;
      this.ctx.lifecycleManager.setOutcome(workspaceId, 'ready_to_merge', { force: true });
      return { url, number };
    } catch (err: any) {
      throw new Error(`Failed to create PR: ${err.message}`);
    }
  }
}
