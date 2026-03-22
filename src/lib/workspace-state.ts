import { useUiStore, type RecentProject } from '../stores/ui';
import { useAgentStore, normalizeClaudeCodeModel } from '../stores/agent';
import { useWorkspaceStore } from '../stores/workspace';
import { useChatStore } from '../stores/chat';
import { useSessionStore } from '../stores/session';
import type { Workspace, Session, SessionMessage, WorkspaceSession } from './ipc-api';
import type { AgentId, TaskMode, ThinkingLevel, FileAttachment } from './types';
import { restoreSessionMessage } from './session-messages';

function basename(value: string): string {
  return value.split('/').pop() || value.split('\\').pop() || value;
}

/** Returns true if a workspace's SSH host is connected (or it's a local workspace). */
export function isWorkspaceSshAvailable(ws: Workspace): boolean {
  if (!ws.sshHost) return true;
  return useUiStore.getState().connectedSshHosts.has(ws.sshHost);
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
  useUiStore.getState().connectSsh(resolvedHost, resolvedCwd);
  return { host: resolvedHost, cwd: resolvedCwd };
}

export async function disconnectFromSshWorkspace(): Promise<{ cwd?: string }> {
  const result = await window.api.invoke('ssh:disconnect') as { cwd?: string };
  useUiStore.getState().disconnectSsh(result?.cwd || useUiStore.getState().cwd);
  return result;
}

export interface CreateWorkspaceAndChatOptions {
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking: ThinkingLevel;
  cwd: string;
  parentRepo?: string;
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
  taskId?: string;
  images?: string[];
  attachments?: FileAttachment[];
}

export interface StartWorkspaceMergeOptions {
  workspace: Workspace;
  targetBranch: string;
  squash: boolean;
  agentId?: AgentId;
  model?: string;
  thinking?: ThinkingLevel;
}

function buildWorkspaceMergeTaskPrompt(
  workspace: Workspace,
  targetBranch: string,
  squash: boolean,
): string {
  return [
    `Merge workspace branch \`${workspace.branch}\` into \`${targetBranch}\`.`,
    'Follow the merge instructions provided above for the exact merge procedure and conflict-handling rules.',
    `Strategy: ${squash ? 'squash merge' : 'merge commit'}.`,
  ].join('\n');
}

function isMissingIpcHandler(error: unknown, channel: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`No handler registered for '${channel}'`);
}

const FUN_BRANCH_PATTERN = /^flux\/[a-z]+-[a-z]+$/;
const AUTO_GENERATED_WORKSPACE_BRANCH_PATTERN = /^flux\/workspace-[a-z0-9-]+$/;
// Matches prompt-derived branches: flux/<slug>-<6char-suffix>
const PROMPT_DERIVED_BRANCH_PATTERN = /^flux\/[a-z0-9-]+-[a-z0-9]{6}$/;
const NAME_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'please', 'that', 'the', 'their', 'them',
  'they', 'this', 'to', 'us', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
  'your', 'just', 'really', 'very', 'user', 'users', 'task', 'tasks', 'thing', 'things', 'something',
]);

function normalizePromptLine(prompt: string): string {
  return prompt
    .split('\n')
    .map((item) => item.trim())
    .find(Boolean) ?? '';
}

function promptKeywords(prompt: string, maxWords = 6): string[] {
  const firstLine = normalizePromptLine(prompt)
    .replace(/`[^`]*`/g, ' ')
    .replace(/^([>#*\-]|\d+[.)])+\s+/g, ' ')
    .replace(/[.!?;:]+/g, ' ')
    .trim();

  const words = firstLine.match(/[a-z0-9]+/gi) ?? [];
  const filtered = words
    .map((word) => word.toLowerCase())
    .filter((word) => !NAME_STOP_WORDS.has(word));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const word of filtered) {
    if (seen.has(word)) continue;
    deduped.push(word);
    seen.add(word);
    if (deduped.length >= maxWords) break;
  }

  return deduped;
}

function toTitleCase(words: string[]): string {
  return words
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ')
    .slice(0, 40);
}

export function deriveWorkspaceNameFromPrompt(prompt: string): string {
  const keywords = promptKeywords(prompt, 6);
  if (keywords.length > 0) return toTitleCase(keywords);

  const fallback = normalizePromptLine(prompt);
  return (fallback || 'Workspace').slice(0, 40);
}

export function deriveBranchSlugFromSeed(seed: string, maxSlug = 32): string {
  const keywords = promptKeywords(seed, 6);
  if (keywords.length > 0) return keywords.join('-').slice(0, maxSlug);

  return seed.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxSlug);
}

function randomSuffix(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

export function createFluxBranchName(seed: string, maxSlug = 32): string {
  const slug = deriveBranchSlugFromSeed(seed, maxSlug) || 'workspace';
  return `flux/${slug}-${randomSuffix()}`;
}

function isAutoGeneratedBranch(branch: string): boolean {
  return FUN_BRANCH_PATTERN.test(branch) || AUTO_GENERATED_WORKSPACE_BRANCH_PATTERN.test(branch) || PROMPT_DERIVED_BRANCH_PATTERN.test(branch);
}

export async function createEmptyWorkspace(opts: {
  agentId: AgentId;
  model: string;
  mode?: TaskMode;
  thinking?: ThinkingLevel;
  cwd: string;
  sshHost?: string;
}): Promise<Workspace> {
  const effectiveSshHost = opts.sshHost ?? useUiStore.getState().sshHost ?? undefined;
  const workspace = await window.api.invoke('workspace:create-quick', {
    parentRepo: opts.cwd,
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    sshHost: effectiveSshHost,
  }) as Workspace;

  useWorkspaceStore.getState().addWorkspace(workspace);
  useWorkspaceStore.getState().setActiveWorkspace(workspace.id);
  return workspace;
}

export async function restoreWorkspaceChats(
  workspace: Workspace,
  options?: { activate?: boolean; sessions?: WorkspaceSession[] },
): Promise<void> {
  const sessions = options?.sessions
    ?? (await window.api.invoke('workspace:list-chats', { workspaceId: workspace.id }) as WorkspaceSession[]);

  useWorkspaceStore.getState().setWorkspaceSessions(workspace.id, sessions);

  const chatStore = useChatStore.getState();
  const thinking = workspace.thinking ?? useAgentStore.getState().selectedThinking;
  const activate = options?.activate ?? true;

  for (const workspaceSession of sessions) {
    const existingTask = Array.from(chatStore.tasks.values()).find(
      (task) => task.workspaceId === workspace.id && task.sessionId === workspaceSession.sessionId,
    );
    if (existingTask) continue;

    const session = await window.api.invoke('sessions:get', { id: workspaceSession.sessionId }) as Session | null;
    if (!session) continue;

    const messages = await window.api.invoke('sessions:messages', { id: workspaceSession.sessionId }) as SessionMessage[];
    const restoredMessages = messages
      .map((message) => restoreSessionMessage(message))
      .filter((message): message is NonNullable<typeof message> => !!message);
    const taskId = workspaceSession.taskId ?? crypto.randomUUID();

    chatStore.createTask({
      id: taskId,
      title: workspaceSession.label || session.title || workspace.name,
      agentId: (session.agentId || workspace.agentId) as AgentId,
      model: normalizeClaudeCodeModel(session.model || workspace.model, session.agentId || workspace.agentId),
      mode: session.mode,
      thinking,
      cwd: workspace.worktreePath,
      sessionId: session.id,
      workspaceId: workspace.id,
      activate,
    });

    chatStore.restoreMessages(taskId, restoredMessages);
    chatStore.setTaskStatus(taskId, workspace.status === 'error' ? 'error' : 'done');
    useSessionStore.getState().upsertSession(session);
  }
}

export function applyWorkspaceDeleted(workspaceId: string): void {
  const workspaceStore = useWorkspaceStore.getState();
  const chatStore = useChatStore.getState();
  const wasActive = workspaceStore.activeWorkspaceId === workspaceId;
  const nextWorkspace = Array.from(workspaceStore.workspaces.values())
    .filter((workspace) => workspace.id !== workspaceId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  workspaceStore.removeWorkspace(workspaceId);
  chatStore.removeTasksForWorkspace(workspaceId);

  if (!wasActive) return;

  if (!nextWorkspace) {
    chatStore.setActiveTask(null);
    return;
  }

  workspaceStore.setActiveWorkspace(nextWorkspace.id);
  const nextTask = Array.from(chatStore.tasks.values())
    .filter((task) => task.workspaceId === nextWorkspace.id)
    .sort((left, right) => (right.activeRun?.startedAt ?? 0) - (left.activeRun?.startedAt ?? 0))[0];
  chatStore.setActiveTask(nextTask?.id ?? null);
}

export async function startWorkspaceChat(
  opts: StartWorkspaceChatOptions,
): Promise<{ taskId: string; session: Session }> {
  const taskId = opts.taskId ?? crypto.randomUUID();
  const title = opts.prompt.trim().slice(0, 80) || 'New chat';
  primeWorkspaceTask({
    taskId,
    title,
    workspace: opts.workspace,
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    prompt: opts.prompt,
    images: opts.images,
    attachments: opts.attachments,
    initialStatus: 'running',
  });

  let session: Session;
  try {
    try {
      const result = await window.api.invoke('workspace:spawn-chat', {
        taskId,
        workspaceId: opts.workspace.id,
        prompt: opts.prompt,
        mode: opts.mode,
        agentId: opts.agentId,
        model: opts.model,
        images: opts.images,
        attachments: opts.attachments,
      }) as { taskId: string; session: Session };
      session = result.session;
    } catch (error) {
      if (!isMissingIpcHandler(error, 'workspace:spawn-chat')) {
        throw error;
      }

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
      session = result.session;
    }
  } catch (error) {
    failWorkspaceTask(taskId, opts.workspace.id);
    throw error;
  }

  finalizeWorkspaceTask({
    taskId,
    session,
    workspace: opts.workspace,
  });

  return { taskId, session };
}

export async function startWorkspaceMerge(
  opts: StartWorkspaceMergeOptions,
): Promise<{ taskId: string; session: Session }> {
  // If the workspace still has an auto-generated branch, try to rename it
  // from its commit history so the merge commit message is human-friendly.
  let workspace = opts.workspace;
  if (isAutoGeneratedBranch(workspace.branch)) {
    try {
      const commitSubject = await window.api.invoke('workspace:get-commit-subject', {
        workspaceId: workspace.id,
      }) as string | null;
      if (commitSubject) {
        const name = deriveWorkspaceNameFromPrompt(commitSubject);
        const newBranch = createFluxBranchName(name);
        const renamed = await window.api.invoke('workspace:rename-branch', {
          workspaceId: workspace.id,
          newBranch,
          newName: name,
        }) as Workspace | undefined;
        if (renamed) {
          useWorkspaceStore.getState().updateWorkspace(workspace.id, {
            branch: renamed.branch,
            name: renamed.name,
            worktreePath: renamed.worktreePath,
          });
          workspace = renamed;
        }
      }
    } catch {
      // Non-fatal: proceed with the current name
    }
  }

  const taskId = crypto.randomUUID();
  const agentId = (opts.agentId ?? workspace.actAgentId ?? workspace.agentId) as AgentId;
  const model = opts.model ?? workspace.actModel ?? workspace.model;
  const thinking = opts.thinking ?? workspace.actThinking ?? workspace.thinking ?? 'medium';
  const prompt = buildWorkspaceMergeTaskPrompt(workspace, opts.targetBranch, opts.squash);
  primeWorkspaceTask({
    taskId,
    title: `Merge ${workspace.name} -> ${opts.targetBranch}`.slice(0, 80),
    workspace,
    agentId,
    model,
    mode: 'act',
    thinking,
    prompt,
    initialStatus: 'merging',
  });

  try {
    const result = await window.api.invoke('task:spawn', {
      taskId,
      workspaceId: workspace.id,
      prompt,
      agentId,
      model,
      mode: 'act',
      thinking,
      cwd: workspace.worktreePath,
      autoApprovePermissions: true,
      workspaceAction: 'merge',
      mergeContext: {
        targetBranch: opts.targetBranch,
        squash: opts.squash,
      },
    }) as { taskId?: string; session: Session };
    const effectiveTaskId = result.taskId ?? taskId;
    if (effectiveTaskId !== taskId) {
      failWorkspaceTask(taskId, workspace.id);
      throw new Error('Workspace merge returned an unexpected task id');
    }

    finalizeWorkspaceTask({
      taskId,
      session: result.session,
      workspace,
    });

    return { taskId, session: result.session };
  } catch (error) {
    failWorkspaceTask(taskId, workspace.id);
    throw error;
  }
}

export async function createWorkspaceAndChat(
  prompt: string,
  opts: CreateWorkspaceAndChatOptions,
): Promise<{ workspace: Workspace; taskId: string; session: Session }> {
  // Derive a meaningful branch name and workspace title from the prompt upfront.
  // The agent can still refine via `.context/state.json` workspace_name at completion.
  const branch = createFluxBranchName(prompt);
  const effectiveParentRepo = opts.parentRepo ?? opts.cwd;
  const effectiveSshHost = useUiStore.getState().sshHost ?? undefined;

  const workspace = await window.api.invoke('workspace:create', {
    name: deriveWorkspaceNameFromPrompt(prompt),
    parentRepo: effectiveParentRepo,
    branch,
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    sshHost: effectiveSshHost,
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

function primeWorkspaceTask(opts: {
  taskId: string;
  title: string;
  workspace: Workspace;
  agentId: AgentId;
  model: string;
  mode: TaskMode;
  thinking: ThinkingLevel;
  prompt: string;
  images?: string[];
  attachments?: FileAttachment[];
  initialStatus: Workspace['status'];
}): void {
  useChatStore.getState().upsertTaskShell({
    id: opts.taskId,
    title: opts.title,
    agentId: opts.agentId,
    model: opts.model,
    mode: opts.mode,
    thinking: opts.thinking,
    cwd: opts.workspace.worktreePath,
    workspaceId: opts.workspace.id,
  });
  useChatStore.getState().addUserMessage(opts.taskId, opts.prompt, opts.images, opts.attachments);
  useChatStore.getState().setTaskStatus(opts.taskId, 'running');
  useChatStore.getState().setActiveTask(opts.taskId);
  useWorkspaceStore.getState().setActiveWorkspace(opts.workspace.id);
  useWorkspaceStore.getState().updateWorkspace(opts.workspace.id, {
    status: opts.initialStatus,
  });
}

function finalizeWorkspaceTask(opts: {
  taskId: string;
  session: Session;
  workspace: Workspace;
}): void {
  useChatStore.getState().setTaskSessionId(opts.taskId, opts.session.id);
  useWorkspaceStore.getState().updateWorkspace(opts.workspace.id, {
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

function failWorkspaceTask(taskId: string, workspaceId: string): void {
  useChatStore.getState().setTaskStatus(taskId, 'error');
  useWorkspaceStore.getState().updateWorkspace(workspaceId, {
    status: 'error',
  });
}
