/**
 * Shared handler operations used by both the IPC layer (Electron renderer)
 * and the Remote Control transport (WebSocket / mobile).
 *
 * Every function here is the single source of truth for its operation.
 * Neither layer should reimplement the orchestration — they should
 * delegate here instead.
 */
import crypto from 'crypto';
import fs from 'fs';
import type { FileAttachment } from '../agents/types';
import type { DiffScope } from '../worktree/types';
import { getChangedFiles, getFileDiff } from '../worktree/diff';
import { agentManager } from '../agents/manager';
import type { IpcContext, SpawnTaskRunOptions } from './types';
import { WorkspaceGroupStore } from '../workspace-group/store';
import {
  requireFields,
  toStoredMessage,
  buildStoredUserMessage,
  buildUserMessagePayload,
  buildPromptWithAttachments,
  buildWorkspaceSystemContext,
  extractLatestSessionAttachmentContext,
  writeAttachmentContextFile,
} from './utils';

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------

export async function detectAgents() {
  return agentManager.detectAll();
}

// ---------------------------------------------------------------------------
// Active tasks
// ---------------------------------------------------------------------------

export function getActiveTasks(ctx: IpcContext) {
  const tasks: Array<{
    taskId: string;
    agentId: string;
    workspaceId?: string;
    isAlive: boolean;
    pid?: number;
  }> = [];
  for (const [taskId, handle] of ctx.activeTasks.entries()) {
    tasks.push({
      taskId,
      agentId: handle.agentId,
      workspaceId: ctx.lifecycleManager.getWorkspaceForTask(taskId),
      isAlive: handle.isAlive(),
      pid: handle.pid,
    });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Task approval / denial / answer
// ---------------------------------------------------------------------------

export function approveTask(ctx: IpcContext, taskId: string, requestId: string) {
  const handle = ctx.activeTasks.get(taskId);
  if (handle) handle.approve(requestId);
  ctx.taskStallMonitors.get(taskId)?.resume();
}

export function denyTask(ctx: IpcContext, taskId: string, requestId: string) {
  const handle = ctx.activeTasks.get(taskId);
  if (handle) handle.deny(requestId);
  ctx.taskStallMonitors.get(taskId)?.resume();
}

export function answerTaskQuestion(
  ctx: IpcContext,
  taskId: string,
  requestId: string,
  response: string,
) {
  requireFields({ taskId, requestId, response }, 'taskId', 'requestId', 'response');

  const handle = ctx.activeTasks.get(taskId);
  if (!handle) {
    throw new Error(`Task ${taskId} does not have an active run`);
  }
  if (!handle.isAlive()) {
    throw new Error('Agent process has exited — answer cannot be delivered');
  }

  // Deliver the answer first — this may throw if stdin is not writable.
  // We must not change status or emit the user message if delivery fails,
  // so the UI can restore the question prompt and let the user retry.
  handle.answerQuestion(requestId, response);

  const sessionId = ctx.taskSessions.get(taskId);
  if (sessionId) {
    const userMsg = buildUserMessagePayload(response);
    ctx.sessionStore.addMessage(sessionId, toStoredMessage(userMsg));
    ctx.sendToRenderer('agent:message', { taskId, message: userMsg });
  }

  const workspaceId = ctx.lifecycleManager.getWorkspaceForTask(taskId);
  if (workspaceId) {
    ctx.lifecycleManager.taskStatusChanged(taskId, 'running', sessionId ? { sessionId } : undefined);
  }

  ctx.taskStallMonitors.get(taskId)?.resume();
}

// ---------------------------------------------------------------------------
// Steer task
// ---------------------------------------------------------------------------

export async function steerTask(
  ctx: IpcContext,
  taskId: string,
  prompt: string,
  images?: string[],
  attachments?: FileAttachment[],
): Promise<{ steerFailed: boolean; reason?: string }> {
  requireFields({ taskId, prompt }, 'taskId', 'prompt');
  const workspaceGroupStore = new WorkspaceGroupStore();

  const handle = ctx.activeTasks.get(taskId);
  if (!handle) {
    return { steerFailed: true, reason: 'task_finished' };
  }
  if (!handle.isAlive()) {
    return { steerFailed: true, reason: 'process_exited' };
  }

  const sessionId = ctx.taskSessions.get(taskId);
  const activeSession = sessionId ? ctx.sessionStore.get(sessionId) : null;
  const previousAttachmentContext = sessionId
    ? extractLatestSessionAttachmentContext(ctx.sessionStore, sessionId)
    : null;
  const attachmentContext = await writeAttachmentContextFile(
    activeSession?.cwd ?? ctx.getCurrentCwd(),
    {
      images: images?.length ? images : previousAttachmentContext?.images,
      attachments: attachments?.length ? attachments : previousAttachmentContext?.attachments,
      sshHost: ctx.getSshHost(),
    },
  );
  let effectivePrompt = await buildPromptWithAttachments(prompt, attachments, ctx.getSshHost());

  // Inject workspace skills on follow-up messages so the agent retains
  // lifecycle protocol context across the full conversation.
  const workspaceId = ctx.lifecycleManager.getWorkspaceForTask(taskId);
  if (workspaceId) {
    const workspace = ctx.workspaceStore.get(workspaceId);
    if (workspace) {
      const siblingContext = workspaceGroupStore.getGroupForWorkspace(workspace.id)?.siblings;
      const attachmentsForSkills = attachmentContext
        ? {
            manifestPath: attachmentContext.manifestPath,
            imageCount: attachmentContext.imageCount,
            fileCount: attachmentContext.attachmentCount,
          }
        : undefined;
      const wsContext = buildWorkspaceSystemContext(workspace, workspace.mode, {
        agentId: workspace.agentId,
        isExistingSession: true,
        attachments: attachmentsForSkills,
        siblingWorkspaces: siblingContext,
      });
      if (wsContext) {
        effectivePrompt = `${wsContext}\n\n${effectivePrompt}`;
      }
    }
  }

  handle.steer(effectivePrompt, images);
  ctx.taskStallMonitors.get(taskId)?.resume();

  if (sessionId) {
    ctx.sessionStore.addMessage(
      sessionId,
      buildStoredUserMessage(prompt, images, attachments),
    );
  }
  return { steerFailed: false };
}

// ---------------------------------------------------------------------------
// Workspace operations
// ---------------------------------------------------------------------------

export async function stopWorkspace(ctx: IpcContext, workspaceId: string): Promise<void> {
  requireFields({ workspaceId }, 'workspaceId');
  await ctx.lifecycleManager.serialized(workspaceId, async () => {
    const taskIds = ctx.lifecycleManager.getActiveTaskIds(workspaceId);
    for (const taskId of taskIds) {
      ctx.releaseTask(taskId);
      ctx.lifecycleManager.clearTask(taskId);
      ctx.sendToRenderer('agent:done', { taskId, error: undefined });
    }
    ctx.lifecycleManager.setStatus(workspaceId, 'idle');
  });
}

export async function spawnWorkspaceChat(
  ctx: IpcContext,
  input: {
    taskId?: string;
    workspaceId: string;
    prompt: string;
    mode?: 'plan' | 'act' | 'ask' | 'architect';
    agentId?: string;
    model?: string;
    images?: string[];
    attachments?: Array<{ path: string; name: string }>;
  },
): Promise<{ taskId: string; session: any }> {
  requireFields(input as Record<string, unknown>, 'workspaceId', 'prompt');

  const workspace = ctx.workspaceStore.get(input.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${input.workspaceId} not found`);
  }
  if (!fs.existsSync(workspace.worktreePath)) {
    throw new Error(`Worktree directory does not exist: ${workspace.worktreePath}`);
  }

  const taskId = input.taskId ?? crypto.randomUUID();
  const result = await ctx.spawnTaskRun({
    taskId,
    workspaceId: workspace.id,
    prompt: input.prompt,
    agentId: (input.agentId ?? workspace.agentId) as any,
    model: input.model ?? workspace.model,
    mode: input.mode ?? workspace.mode,
    cwd: workspace.worktreePath,
    images: input.images,
    attachments: input.attachments,
  });

  return { taskId, session: result.session };
}

export function listWorkspaceChats(ctx: IpcContext, workspaceId: string) {
  requireFields({ workspaceId }, 'workspaceId');
  return ctx.workspaceStore.listSessions(workspaceId);
}

export function activeWorkspaceTaskIds(ctx: IpcContext, workspaceId: string) {
  requireFields({ workspaceId }, 'workspaceId');
  return ctx.lifecycleManager.getActiveTaskIds(workspaceId);
}

export function listMulti(ctx: IpcContext, parentRepos: string[]) {
  requireFields({ parentRepos }, 'parentRepos');
  const normalizedRepos = [...new Set(parentRepos.map((r) => r.trim()).filter(Boolean))];
  if (normalizedRepos.length === 0) {
    return ctx.workspaceStore.list();
  }
  const results = [];
  for (const repo of normalizedRepos) {
    results.push(...ctx.workspaceStore.list(repo));
  }
  return results.length > 0 ? results : ctx.workspaceStore.list();
}

export async function diffFiles(ctx: IpcContext, workspaceId: string) {
  requireFields({ workspaceId }, 'workspaceId');
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  return getChangedFiles(workspace.worktreePath, workspace.parentRepo);
}

export async function fileDiff(
  ctx: IpcContext,
  workspaceId: string,
  filePath: string,
  scope?: DiffScope,
) {
  requireFields({ workspaceId, filePath }, 'workspaceId', 'filePath');
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
  return getFileDiff(workspace.worktreePath, filePath, workspace.parentRepo, scope ?? 'all');
}

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------

export function getSession(ctx: IpcContext, id: string) {
  requireFields({ id }, 'id');
  return ctx.sessionStore.get(id);
}

export function sessionMessages(ctx: IpcContext, id: string) {
  requireFields({ id }, 'id');
  return ctx.sessionStore.getMessages(id);
}
