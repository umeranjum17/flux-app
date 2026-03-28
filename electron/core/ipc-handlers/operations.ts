/**
 * Shared handler operations used by both the IPC layer (Electron renderer)
 * and the Remote Control transport (WebSocket / mobile).
 *
 * Every function here is the single source of truth for its operation.
 * Neither layer should reimplement the orchestration — they should
 * delegate here instead.
 */
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FileAttachment, TaskMode } from '../agents/types';
import type { DiffScope, Workspace } from '../worktree/types';
import { getChangedFiles, getFileDiff } from '../worktree/diff';
import { createWorkspaceFs } from '../worktree/workspace-fs';
import { escapeShell } from '../worktree/remote-manager';
import { agentManager } from '../agents/manager';
import { extendedEnv } from '../process-utils';
import { logDiagnostic } from '../diagnostics/logger';
import type { IpcContext, SpawnTaskRunOptions } from './types';

const execFileAsync = promisify(execFile);
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

export function wrapWorkspaceActionError(workspace: Workspace, action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (!workspace.sshHost) {
    return new Error(`Failed to ${action}: ${detail}`);
  }

  return new Error(
    `Failed to ${action} for SSH workspace ${workspace.sshHost}:${workspace.parentRepo}. `
    + `Reconnect SSH or verify your host and credentials. ${detail}`,
  );
}

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

  // Derive sshHost from the workspace record only — no global fallback
  const workspaceId = ctx.lifecycleManager.getWorkspaceForTask(taskId);
  const workspace = workspaceId ? ctx.workspaceStore.get(workspaceId) : null;
  const effectiveSshHost = workspace?.sshHost ?? undefined;
  logDiagnostic('task-handlers', '[task:steer] sshHost resolution', {
    taskId,
    workspaceId: workspaceId ?? null,
    workspaceName: workspace?.name ?? null,
    workspaceSshHost: workspace?.sshHost ?? null,
    effectiveSshHost: effectiveSshHost ?? null,
    handleAlive: handle.isAlive(),
    sessionCwd: activeSession?.cwd ?? null,
  });

  const attachmentContext = await writeAttachmentContextFile(
    activeSession?.cwd ?? ctx.getCurrentCwd(),
    {
      images: images?.length ? images : previousAttachmentContext?.images,
      attachments: attachments?.length ? attachments : previousAttachmentContext?.attachments,
      sshHost: effectiveSshHost ?? null,
    },
  );
  let effectivePrompt = await buildPromptWithAttachments(prompt, attachments);

  // When the user steers a workspace, move it back to "in_progress" so the
  // kanban board reflects that the agent is actively building again.
  // This must happen BEFORE building skill context so the agent sees the
  // updated outcome in its skill prompt and moves forward organically.
  if (workspaceId && workspace && workspace.outcome !== 'in_progress') {
    ctx.lifecycleManager.setOutcome(workspaceId, 'in_progress', { force: true });
  }

  // Inject workspace skills on follow-up messages so the agent retains
  // lifecycle protocol context across the full conversation.
  if (workspaceId && workspace) {
    // Re-read workspace to pick up the outcome reset above
    const freshWorkspace = ctx.workspaceStore.get(workspaceId) ?? workspace;
    const siblingContext = workspaceGroupStore.getGroupForWorkspace(freshWorkspace.id)?.siblings;
    const attachmentsForSkills = attachmentContext
      ? {
          manifestPath: attachmentContext.manifestPath,
          imageCount: attachmentContext.imageCount,
          fileCount: attachmentContext.attachmentCount,
        }
      : undefined;
    const wsContext = buildWorkspaceSystemContext(freshWorkspace, freshWorkspace.mode, {
      agentId: freshWorkspace.agentId,
      isExistingSession: true,
      attachments: attachmentsForSkills,
      siblingWorkspaces: siblingContext,
    });
    if (wsContext) {
      effectivePrompt = `${wsContext}\n\n${effectivePrompt}`;
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
    mode?: TaskMode;
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
  const wfs = createWorkspaceFs(workspace.sshHost);
  if (!(await wfs.exists(workspace.worktreePath))) {
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
    sshHost: workspace.sshHost,
    sessionId: workspace.sessionId,
    images: input.images,
    attachments: input.attachments,
  });

  // Persist the session ID back to the workspace so subsequent steering/re-runs
  // resume the same session instead of creating a new one each time.
  if (result.session?.id && result.session.id !== workspace.sessionId) {
    ctx.workspaceStore.update(workspace.id, { sessionId: result.session.id });
  }

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
  if (!workspace) return [];
  return getChangedFiles(workspace.worktreePath, workspace.parentRepo, workspace.sshHost);
}

export async function fileDiff(
  ctx: IpcContext,
  workspaceId: string,
  filePath: string,
  scope?: DiffScope,
) {
  requireFields({ workspaceId, filePath }, 'workspaceId', 'filePath');
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) return null;
  return getFileDiff(workspace.worktreePath, filePath, workspace.parentRepo, scope ?? 'all', workspace.sshHost);
}

// ---------------------------------------------------------------------------
// Branch & PR operations
// ---------------------------------------------------------------------------

export async function renameBranch(
  ctx: IpcContext,
  workspaceId: string,
  newBranch: string,
  newName?: string,
) {
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const trimmedName = newName?.trim();
  let nextBranch = workspace.branch;
  if (newBranch.trim() && newBranch !== workspace.branch) {
    try {
      const wfs = createWorkspaceFs(workspace.sshHost);
      await wfs.git(workspace.worktreePath, ['branch', '-m', workspace.branch, newBranch], { timeout: 10000 });
      nextBranch = newBranch;
    } catch { /* best-effort */ }
  }

  const updated = ctx.workspaceStore.update(workspaceId, {
    branch: nextBranch,
    ...(trimmedName ? { name: trimmedName } : {}),
  });
  if (!updated) throw new Error(`Workspace ${workspaceId} not found`);
  return updated;
}

export async function mergePreview(
  ctx: IpcContext,
  workspaceId: string,
  targetBranch: string,
) {
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const wfs = createWorkspaceFs(workspace.sshHost);
  const { worktreePath, parentRepo } = workspace;

  let mergeBase = '';
  try {
    const { stdout } = await wfs.git(worktreePath, ['merge-base', 'HEAD', targetBranch]);
    mergeBase = stdout.trim();
  } catch { /* no common ancestor */ }

  let commitsAhead = 0;
  if (mergeBase) {
    try {
      const { stdout } = await wfs.git(worktreePath, ['rev-list', '--count', `${mergeBase}..HEAD`]);
      commitsAhead = parseInt(stdout.trim(), 10) || 0;
    } catch { /* fallback */ }
  }

  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  try {
    const diffRef = mergeBase || targetBranch;
    const { stdout } = await wfs.git(worktreePath, ['diff', '--stat', '--numstat', diffRef]);
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
    await wfs.git(worktreePath, ['merge-base', '--is-ancestor', targetBranch, 'HEAD']);
    canFastForward = true;
  } catch {
    try {
      await wfs.git(parentRepo, ['merge-tree', '--write-tree', '--no-messages', targetBranch, workspace.branch]);
    } catch (err: any) {
      const stderr = err.stderr ?? err.message ?? '';
      if (stderr) {
        for (const line of (stderr as string).split('\n')) {
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

export async function createPr(
  ctx: IpcContext,
  workspaceId: string,
  title: string,
  body: string,
  targetBranch: string,
  draft?: boolean,
) {
  const workspace = ctx.workspaceStore.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  const wfs = createWorkspaceFs(workspace.sshHost);

  try {
    await wfs.git(workspace.worktreePath, ['push', '-u', 'origin', workspace.branch], { timeout: 60000 });
  } catch (error) {
    throw wrapWorkspaceActionError(workspace, 'push the workspace branch', error);
  }

  const ghArgs = ['pr', 'create',
    '--title', title,
    '--body', body,
    '--base', targetBranch,
    '--head', workspace.branch,
  ];
  if (draft) ghArgs.push('--draft');

  try {
    let url: string;
    if (wfs.isRemote) {
      // Remote: must go through shell
      const ghCommand = `gh ${ghArgs.map(a => `'${escapeShell(a)}'`).join(' ')}`;
      const result = await wfs.exec(workspace.parentRepo, ghCommand, { timeout: 30000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
      url = result.stdout.trim();
    } else {
      // Local: use execFileAsync to avoid shell interpretation of user input
      const { stdout } = await execFileAsync('gh', ghArgs, {
        cwd: workspace.parentRepo,
        timeout: 30000,
        env: extendedEnv(),
      });
      url = stdout.trim();
    }
    const prNumberMatch = url.match(/\/pull\/(\d+)/);
    const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    ctx.lifecycleManager.setOutcome(workspaceId, 'ready_to_merge', { force: true });

    return { url, number };
  } catch (error) {
    throw wrapWorkspaceActionError(workspace, 'create a pull request', error);
  }
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
