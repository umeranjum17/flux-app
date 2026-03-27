/**
 * Remote control service — API surface for the React Native companion app.
 *
 * This is the WebSocket transport, NOT related to SSH workspaces.
 * Every method delegates to the canonical handler in `operations.ts` so the
 * remote (WebSocket) path and the IPC (Electron renderer) path share the
 * exact same orchestration logic.
 */
import type { DiffScope, WorkspaceOutcome } from '../worktree/types';
import type { SpawnOptions, TaskMode } from '../agents/types';
import type { IpcContext } from '../ipc-handlers/types';
import { generateWorkspaceName } from '../worktree/names';
import { createWorktreeAny, removeWorktreeAny } from '../worktree/workspace-fs';
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
  renameBranch,
  mergePreview,
  createPr,
} from '../ipc-handlers/operations';

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
    mode?: TaskMode;
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

  async spawnTask(input: {
    taskId?: string;
    workspaceId: string;
    prompt: string;
    agentId?: string;
    model?: string;
    mode?: SpawnOptions['mode'];
    thinking?: string;
    cwd?: string;
    autoApprovePermissions?: boolean;
    workspaceAction?: 'merge';
    mergeContext?: { targetBranch: string; squash: boolean };
    images?: string[];
    attachments?: Array<{ path: string; name: string }>;
  }) {
    const workspace = this.ctx.workspaceStore.get(input.workspaceId);
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`);

    const taskId = input.taskId ?? require('crypto').randomUUID();
    const result = await this.ctx.spawnTaskRun({
      taskId,
      workspaceId: workspace.id,
      prompt: input.prompt,
      agentId: (input.agentId ?? workspace.agentId) as any,
      model: input.model ?? workspace.model,
      mode: input.mode ?? workspace.mode,
      thinking: input.thinking as any,
      cwd: input.cwd ?? workspace.worktreePath,
      sshHost: workspace.sshHost,
      autoApprovePermissions: input.autoApprovePermissions,
      workspaceAction: input.workspaceAction,
      mergeContext: input.mergeContext,
      images: input.images,
      attachments: input.attachments,
    });

    return { taskId, session: result.session };
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
    sshHost?: string;
  }) {
    const { name, parentRepo, branch, agentId, model, mode, thinking } = input;
    const effectiveSshHost = input.sshHost ?? this.ctx.remoteConnection.host ?? undefined;
    const { worktree, baseBranch } = await createWorktreeAny(effectiveSshHost, parentRepo, branch, branch);

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
      sshHost: effectiveSshHost,
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
    sshHost?: string;
  }) {
    const { parentRepo, agentId, model, mode, thinking } = input;
    const effectiveSshHost = input.sshHost ?? this.ctx.remoteConnection.host ?? undefined;

    const workspaceName = generateWorkspaceName();
    const branch = `flux/${workspaceName}`;
    const { worktree, baseBranch } = await createWorktreeAny(effectiveSshHost, parentRepo, branch, workspaceName);

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
      sshHost: effectiveSshHost,
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

      await removeWorktreeAny(workspace.sshHost, workspace.parentRepo, workspace.worktreePath);
      workspaceStore.delete(workspaceId);
      sendToRenderer('workspace:deleted', { workspaceId });
    });
  }

  async archiveWorkspace(workspaceId: string) {
    const { workspaceStore, operationManager, lifecycleManager, sendToRenderer, releaseTask } = this.ctx;
    const workspace = workspaceStore.get(workspaceId) ?? workspaceStore.getIncludingMissing(workspaceId);
    if (!workspace) {
      // Already gone — clean up and return a completed noop
      workspaceStore.delete(workspaceId);
      sendToRenderer('workspace:deleted', { workspaceId });
      return { operation: null };
    }

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
            await removeWorktreeAny(workspace.sshHost, workspace.parentRepo, workspace.worktreePath, { signal });
            update({ stage: 'cleaning_db', progress: 0.88, message: 'Cleaning workspace records', cancellable: false });
            workspaceStore.delete(workspaceId);
            sendToRenderer('workspace:deleted', { workspaceId });
          });
        },
      }),
    };
  }

  async renameBranch(workspaceId: string, newBranch: string, newName?: string) {
    return renameBranch(this.ctx, workspaceId, newBranch, newName);
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
    return mergePreview(this.ctx, workspaceId, targetBranch);
  }

  async merge(workspaceId: string, _targetBranch: string, _squash?: boolean) {
    const workspace = this.ctx.workspaceStore.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    throw new Error(`Direct workspace merges are disabled for ${workspace.name}. Start an Agent Merge instead.`);
  }

  async createPr(workspaceId: string, title: string, body: string, targetBranch: string, draft?: boolean) {
    return createPr(this.ctx, workspaceId, title, body, targetBranch, draft);
  }
}
