import { useUiStore, type RecentProject } from '../stores/ui';
import { useWorkspaceStore } from '../stores/workspace';
import { useChatStore } from '../stores/chat';
import { useSessionStore } from '../stores/session';
import type { Workspace, Session } from './ipc-api';
import type { AgentId, TaskMode, ThinkingLevel, FileAttachment } from './types';

function basename(value: string): string {
  return value.split('/').pop() || value.split('\\').pop() || value;
}

export function createRecentProject(
  path: string,
  options?: { isSSH?: boolean; sshHost?: string | null; lastOpened?: number },
): RecentProject {
  return {
    path,
    name: basename(path),
    lastOpened: options?.lastOpened ?? Date.now(),
    ...(options?.isSSH ? { isSSH: true, sshHost: options.sshHost ?? undefined } : {}),
  };
}

export async function rememberRecentProject(project: RecentProject): Promise<void> {
  useUiStore.getState().addRecentProject(project);
  await window.api.invoke('config:set', { recentProjects: useUiStore.getState().recentProjects });
}

export async function connectToSshWorkspace(
  host: string,
  remoteCwd?: string,
): Promise<{ host: string; cwd: string }> {
  const result = await window.api.invoke('ssh:connect', {
    host,
    remoteCwd,
  }) as { connected: boolean; cwd: string; host?: string };

  const resolvedHost = result.host ?? host;
  const resolvedCwd = result.cwd ?? remoteCwd ?? '';
  const ui = useUiStore.getState();
  ui.setSshHost(resolvedHost);
  ui.setSshConnected(true);
  ui.setCwd(resolvedCwd);
  return { host: resolvedHost, cwd: resolvedCwd };
}

export async function disconnectFromSshWorkspace(): Promise<{ cwd?: string }> {
  const result = await window.api.invoke('ssh:disconnect') as { cwd?: string };
  const ui = useUiStore.getState();
  ui.setSshHost(null);
  ui.setSshConnected(false);
  if (result?.cwd) {
    ui.setCwd(result.cwd);
  }
  return result;
}

export interface CreateWorkspaceAndChatOptions {
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking: ThinkingLevel;
  cwd: string;
  images?: string[];
  attachments?: FileAttachment[];
}

export interface StartWorkspaceChatOptions {
  workspace: Workspace;
  prompt: string;
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking: ThinkingLevel;
  images?: string[];
  attachments?: FileAttachment[];
  /** Skip auto-renaming the branch (e.g. during merge where the prompt references the current name). */
  skipBranchRename?: boolean;
}

export interface StartWorkspaceMergeOptions {
  workspace: Workspace;
  targetBranch: string;
  squash: boolean;
}

function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<Session>;
  return typeof session.id === 'string'
    && typeof session.title === 'string'
    && typeof session.agentId === 'string'
    && typeof session.model === 'string'
    && typeof session.mode === 'string'
    && typeof session.cwd === 'string'
    && typeof session.createdAt === 'number'
    && typeof session.updatedAt === 'number'
    && !!session.metadata
    && typeof session.metadata === 'object';
}

async function resolveWorkspaceSession(
  workspace: Workspace,
  taskId: string,
  candidate: unknown,
): Promise<Session> {
  if (isValidSession(candidate)) {
    return candidate;
  }

  const sessions = await window.api.invoke('sessions:list') as Session[];
  const latestWorkspaceSession = sessions
    .filter((session) => session.metadata?.workspaceId === workspace.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  if (latestWorkspaceSession) {
    return latestWorkspaceSession;
  }

  throw new Error(`Merge started without a usable session for task ${taskId}`);
}

function isMissingIpcHandler(error: unknown, channel: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`No handler registered for '${channel}'`);
}

const FUN_BRANCH_PATTERN = /^flux\/[a-z]+-[a-z]+$/;

export async function createEmptyWorkspace(opts: {
  agentId: AgentId;
  model: string;
  cwd: string;
}): Promise<Workspace> {
  const workspace = await window.api.invoke('workspace:create-quick', {
    parentRepo: opts.cwd,
    agentId: opts.agentId,
    model: opts.model,
  }) as Workspace;

  useWorkspaceStore.getState().addWorkspace(workspace);
  useWorkspaceStore.getState().setActiveWorkspace(workspace.id);
  return workspace;
}

export async function startWorkspaceChat(
  opts: StartWorkspaceChatOptions,
): Promise<{ taskId: string; session: Session }> {
  let taskId: string;
  let session: Session;

  // If the workspace still has an auto-generated fun name, rename the branch based on the prompt
  if (!opts.skipBranchRename && FUN_BRANCH_PATTERN.test(opts.workspace.branch)) {
    try {
      const slug = opts.prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
      const hash = Math.random().toString(36).slice(2, 6);
      const newBranch = `flux/${slug}-${hash}`;
      await window.api.invoke('workspace:rename-branch', { workspaceId: opts.workspace.id, newBranch });
      useWorkspaceStore.getState().updateWorkspace(opts.workspace.id, { branch: newBranch });
      opts = { ...opts, workspace: { ...opts.workspace, branch: newBranch } };
    } catch {
      // Non-fatal: keep the fun name if rename fails
    }
  }

  try {
    const result = await window.api.invoke('workspace:spawn-chat', {
      workspaceId: opts.workspace.id,
      prompt: opts.prompt,
      mode: opts.mode,
      agentId: opts.agentId,
      model: opts.model,
      images: opts.images,
      attachments: opts.attachments,
    }) as { taskId: string; session: Session };
    taskId = result.taskId;
    session = result.session;
  } catch (error) {
    if (!isMissingIpcHandler(error, 'workspace:spawn-chat')) {
      throw error;
    }

    taskId = crypto.randomUUID();
    const result = await window.api.invoke('task:spawn', {
      taskId,
      workspaceId: opts.workspace.id,
      prompt: opts.prompt,
      agentId: opts.agentId,
      model: opts.model,
      mode: opts.mode,
      thinking: opts.thinking,
      cwd: opts.workspace.worktreePath,
      images: opts.images,
      attachments: opts.attachments,
    }) as { taskId?: string; session: Session };
    taskId = result.taskId ?? taskId;
    session = result.session;
  }

  registerWorkspaceTask({
    taskId,
    session,
    workspace: opts.workspace,
    prompt: opts.prompt,
    title: opts.prompt.trim().slice(0, 80) || 'New chat',
    thinking: opts.thinking,
    images: opts.images,
    attachments: opts.attachments,
    initialStatus: 'running',
  });

  return { taskId, session };
}

export function buildWorkspaceMergePrompt(
  workspace: Workspace,
  targetBranch: string,
  squash: boolean,
): string {
  const mergeMode = squash ? 'a squash merge' : 'a regular merge commit';

  return [
    `Merge workspace branch \`${workspace.branch}\` into \`${targetBranch}\` using ${mergeMode}.`,
    '',
    'Repository context:',
    `- Parent repository: ${workspace.parentRepo}`,
    `- Workspace worktree: ${workspace.worktreePath}`,
    `- Workspace branch: ${workspace.branch}`,
    `- Target branch: ${targetBranch}`,
    '',
    'Requirements:',
    `1. Run the git merge from the parent repository at \`${workspace.parentRepo}\`, not from the detached worktree metadata.`,
    '2. Inspect and clean up stale git state if it blocks the merge, including in-progress merge/rebase/cherry-pick state or a dirty index.',
    `3. Make sure the workspace branch is ready to merge, then merge it into \`${targetBranch}\` with ${mergeMode}.`,
    '4. Resolve straightforward conflicts if you can do so safely. If manual product decisions are required, stop and explain exactly what needs input.',
    '5. Verify the final repo state with git status and a concise summary of what landed.',
    '',
    'You are expected to manage the git workflow directly and report the final result in this chat.',
  ].join('\n');
}

export async function startWorkspaceMerge(
  opts: StartWorkspaceMergeOptions,
): Promise<{ taskId: string; session: Session }> {
  const prompt = buildWorkspaceMergePrompt(opts.workspace, opts.targetBranch, opts.squash);
  const result = await window.api.invoke('workspace:merge', {
    workspaceId: opts.workspace.id,
    targetBranch: opts.targetBranch,
    squash: opts.squash,
    prompt,
  }) as { taskId: string; session?: Session };
  const session = await resolveWorkspaceSession(opts.workspace, result.taskId, result.session);

  registerWorkspaceTask({
    taskId: result.taskId,
    session,
    workspace: opts.workspace,
    prompt,
    title: `Merge ${opts.workspace.branch} -> ${opts.targetBranch}`.slice(0, 80),
    thinking: 'medium',
    initialStatus: 'merging',
  });

  return { taskId: result.taskId, session };
}

export async function createWorkspaceAndChat(
  prompt: string,
  opts: CreateWorkspaceAndChatOptions,
): Promise<{ workspace: Workspace; taskId: string; session: Session }> {
  const name = prompt.trim().slice(0, 40);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  const hash = Math.random().toString(36).slice(2, 6);
  const branch = `flux/${slug}-${hash}`;

  const workspace = await window.api.invoke('workspace:create', {
    name,
    parentRepo: opts.cwd,
    branch,
    agentId: opts.agentId,
    model: opts.model,
  }) as Workspace;

  useWorkspaceStore.getState().addWorkspace(workspace);
  useWorkspaceStore.getState().setActiveWorkspace(workspace.id);

  const { taskId, session } = await startWorkspaceChat({
    workspace,
    prompt,
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    images: opts.images,
    attachments: opts.attachments,
  });

  return { workspace, taskId, session };
}

function registerWorkspaceTask(opts: {
  taskId: string;
  session: Session;
  workspace: Workspace;
  prompt: string;
  title: string;
  thinking: ThinkingLevel;
  images?: string[];
  attachments?: FileAttachment[];
  initialStatus: Workspace['status'];
}): void {
  useChatStore.getState().createTask({
    id: opts.taskId,
    title: opts.title,
    agentId: opts.session.agentId as AgentId,
    model: opts.session.model,
    mode: opts.session.mode,
    thinking: opts.thinking,
    cwd: opts.session.cwd,
    sessionId: opts.session.id,
    workspaceId: opts.workspace.id,
  });
  useChatStore.getState().addUserMessage(opts.taskId, opts.prompt, opts.images, opts.attachments);
  useChatStore.getState().setTaskStatus(opts.taskId, 'running');
  useChatStore.getState().setActiveTask(opts.taskId);
  useWorkspaceStore.getState().setActiveWorkspace(opts.workspace.id);
  useWorkspaceStore.getState().updateWorkspace(opts.workspace.id, {
    status: opts.initialStatus,
    sessionId: opts.session.id,
  });
  useWorkspaceStore.getState().addWorkspaceSession(opts.workspace.id, {
    id: 0,
    workspaceId: opts.workspace.id,
    sessionId: opts.session.id,
    taskId: opts.taskId,
    position: 0,
    createdAt: Date.now(),
  });
  useSessionStore.getState().upsertSession(opts.session);
}
