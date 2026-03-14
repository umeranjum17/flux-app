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
  if (FUN_BRANCH_PATTERN.test(opts.workspace.branch)) {
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

  useChatStore.getState().createTask({
    id: taskId,
    title: opts.prompt.trim().slice(0, 80) || 'New chat',
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    cwd: opts.workspace.worktreePath,
    sessionId: session.id,
    workspaceId: opts.workspace.id,
  });
  useChatStore.getState().addUserMessage(taskId, opts.prompt, opts.images, opts.attachments);
  useChatStore.getState().setTaskStatus(taskId, 'running');
  useChatStore.getState().setActiveTask(taskId);
  useWorkspaceStore.getState().setActiveWorkspace(opts.workspace.id);
  useWorkspaceStore.getState().updateWorkspace(opts.workspace.id, {
    status: 'running',
    sessionId: session.id,
  });
  useWorkspaceStore.getState().addWorkspaceSession(opts.workspace.id, {
    id: 0,
    workspaceId: opts.workspace.id,
    sessionId: session.id,
    taskId,
    position: 0,
    createdAt: Date.now(),
  });
  useSessionStore.getState().upsertSession(session);

  return { taskId, session };
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
