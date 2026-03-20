/**
 * Remote control service — thin transport adapter over shared operations.
 *
 * Every method delegates to the canonical handler in `operations.ts` so the
 * remote (WebSocket) path and the IPC (Electron renderer) path share the
 * exact same orchestration logic.
 */
import type { DiffScope } from '../worktree/types';
import type { IpcContext } from '../ipc-handlers/types';
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
}
