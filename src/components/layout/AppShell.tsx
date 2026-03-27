import { useEffect, useCallback, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertTriangle, FolderOpen, Terminal } from 'lucide-react';
import { TopBar } from './TopBar';
// ActivityBar removed — navigation merged into Sidebar icon bar
import { Sidebar } from './Sidebar';
import { StatusLine } from './StatusLine';
import { MessageList } from '../chat/MessageList';
import { LiveRunHeader } from '../chat/LiveRunHeader';
import { TodoBar } from '../chat/TodoBar';
import { ChatInput } from '../input/ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { TabBar } from './TabBar';
import { BottomPanel } from './BottomPanel';
import { FileExplorer } from '../explorer/FileExplorer';
import { useUiStore } from '../../stores/ui';
import { useAgentStore, normalizeClaudeCodeModel } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';
import { useAgentStream } from '../../hooks/useAgentStream';
import { applyTheme } from '../../lib/theme';
import type { AgentId, DetectedAgent, TaskMode, ThinkingLevel } from '../../lib/types';
import type { FluxConfig, Session, EnvironmentInfo, Workspace, SessionMessage, WorkspaceSession, WorkspaceOperation } from '../../lib/ipc-api';
import { useWorkspaceStore } from '../../stores/workspace';
import { ErrorBoundary } from '../ErrorBoundary';
import { WorkspaceActionBar } from '../workspace/WorkspaceActionBar';
import { ChangesPanel } from '../review/ChangesPanel';
import { WorkspaceSidePanel } from '../workspace/WorkspaceSidePanel';
import { MergeDialog } from '../review/MergeDialog';
import { CommitDialog } from '../review/CommitDialog';
import { LinkWorkspaceDialog } from '../workspace/LinkWorkspaceDialog';
import { QuickOpen } from '../dialogs/QuickOpen';
import { SearchFiles } from '../dialogs/SearchFiles';
import { applyWorkspaceDeleted, connectToSshWorkspace, createRecentProject, rememberRecentProject } from '../../lib/workspace-state';
import { restoreSessionMessage } from '../../lib/session-messages';
import { useWorkspaceGroupStore } from '../../stores/workspace-group';
import { ProductView } from '../kanban/ProductView';


type ModeSelection = {
  agentId: AgentId;
  model: string;
  thinking: ThinkingLevel;
};

function getModeSelection(workspace: Workspace, mode: TaskMode, fallbackThinking: ThinkingLevel): ModeSelection {
  if (mode === 'plan' || mode === 'ask' || mode === 'architect') {
    return {
      agentId: (workspace.planAgentId ?? workspace.agentId) as AgentId,
      model: workspace.planModel ?? workspace.model,
      thinking: workspace.planThinking ?? workspace.thinking ?? fallbackThinking,
    };
  }
  return {
    agentId: (workspace.actAgentId ?? workspace.agentId) as AgentId,
    model: workspace.actModel ?? workspace.model,
    thinking: workspace.actThinking ?? workspace.thinking ?? fallbackThinking,
  };
}

function buildModeSelectionPatch(mode: TaskMode, selection: ModeSelection): Partial<Workspace> {
  if (mode === 'plan' || mode === 'ask' || mode === 'architect') {
    return {
      planAgentId: selection.agentId,
      planModel: selection.model,
      planThinking: selection.thinking,
    };
  }
  return {
    actAgentId: selection.agentId,
    actModel: selection.model,
    actThinking: selection.thinking,
  };
}

const MODEL_SWITCH_RESPAWN_DELAY_MS = 10_000;

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const bottomPanelOpen = useUiStore((s) => s.bottomPanelOpen);
  const theme = useUiStore((s) => s.theme);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const viewMode = useUiStore((s) => s.viewMode);
  const tasks = useChatStore((s) => s.tasks);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const mergingWorkspaceId = useWorkspaceStore((s) => s.mergingWorkspaceId);
  const committingWorkspaceId = useWorkspaceStore((s) => s.committingWorkspaceId);
  const changesPanelOpen = useWorkspaceStore((s) => s.changesPanelOpen);
  const linkingWorkspaceId = useUiStore((s) => s.linkingWorkspaceId);
  // Terminal actions are now exposed via useTerminalStore (no ref needed)

  const hasTasks = tasks.size > 0;
  const sessionsLoading = useWorkspaceStore((s) =>
    s.activeWorkspaceId ? s.sessionsLoadingFor.has(s.activeWorkspaceId) : false,
  );
  // Only subscribe to the specific workspace being merged/committed — avoids
  // re-rendering AppShell on every workspace update.
  const mergingWorkspace = useWorkspaceStore((s) => {
    if (!mergingWorkspaceId) return null;
    const workspace = s.workspaces.get(mergingWorkspaceId);
    return workspace ?? null;
  });
  const committingWorkspace = useWorkspaceStore((s) => {
    if (!committingWorkspaceId) return null;
    return s.workspaces.get(committingWorkspaceId) ?? null;
  });

  const [appReady, setAppReady] = useState(false);

  useAgentStream();

  // Detect agents and fetch CWD on mount
  useEffect(() => {
    async function init() {
      useAgentStore.getState().setDetecting(true);
      let restoredProjectPath: string | null = null;
      try {
        // Phase 1: Load config first (fast, needed to route other calls)
        let config: FluxConfig | null = null;
        try {
          config = await window.api.invoke('config:get') as FluxConfig;
          useUiStore.getState().setTheme(config.theme);
          useUiStore.getState().setSendKey(config.sendKey);
          useUiStore.getState().setRecentProjects(config.recentProjects ?? []);
          useAgentStore.getState().setSelectedThinking(config.defaultThinking);
          if (config.defaultMode) {
            useUiStore.getState().setMode(config.defaultMode);
          }
          if (typeof (config as any).autoApprove === 'boolean') {
            useUiStore.getState().setAutoApprove((config as any).autoApprove);
          }
          if (config.openProjects && config.openProjects.length > 0) {
            // Migrate from old string[] format to OpenProject[]
            const normalized = config.openProjects.map((p) =>
              typeof p === 'string'
                ? { path: p, name: p.split('/').pop() || p, environment: 'local' as const }
                : p,
            );
            useUiStore.getState().setOpenProjects(normalized);
            const activePath = config.activeProjectPath;
            if (activePath && normalized.some((p) => p.path === activePath)) {
              restoredProjectPath = activePath;
              useUiStore.getState().setActiveProject(activePath);
            }
          }
          if (config.lastActiveGroupId) {
            useUiStore.getState().setActiveGroupId(config.lastActiveGroupId);
          }
          if (config.viewMode) {
            useUiStore.getState().setViewMode(config.viewMode);
          }
        } catch (err) {
          toast.error('Failed to load configuration');
          console.error('Config load failed:', err);
        }

        // Show the shell immediately — only config was needed for theme/layout
        setAppReady(true);
        useUiStore.getState().setSidebarOpen(true);

        // Phase 2: Fire independent IPC calls in parallel (progressive, non-blocking)
        const cwdPromise = restoredProjectPath
          ? window.api.invoke('cwd:set', { cwd: restoredProjectPath })
          : window.api.invoke('cwd:get');

        const [agentsResult, cwdResult, envResult, sessionsResult] = await Promise.allSettled([
          window.api.invoke('agents:detect') as Promise<DetectedAgent[]>,
          cwdPromise,
          window.api.invoke('env:detect') as Promise<EnvironmentInfo>,
          window.api.invoke('sessions:list', { limit: 50 }) as Promise<Session[]>,
        ]);

        // Apply agents
        if (agentsResult.status === 'fulfilled') {
          const agents = agentsResult.value;
          useAgentStore.getState().setAgents(agents);

          const preferredAgent = config?.defaultAgent
            ? agents.find((agent) => agent.id === config?.defaultAgent && agent.available)
            : undefined;
          if (preferredAgent) {
            useAgentStore.setState((state) => ({
              ...state,
              selectedAgentId: preferredAgent.id,
              selectedModel: config?.defaultModel || preferredAgent.models[0] || state.selectedModel,
              dynamicModels: [],
            }));
            // Fire-and-forget: model list only populates a dropdown
            useAgentStore.getState().fetchModels(preferredAgent.id).then(() => {
              if (config?.defaultModel) {
                const availableModels = useAgentStore.getState().dynamicModels.map((model) => model.id);
                if (availableModels.includes(config.defaultModel) || preferredAgent.models.includes(config.defaultModel)) {
                  useAgentStore.getState().setSelectedModel(config.defaultModel);
                }
              }
            }).catch(console.error);
          }
        } else {
          toast.error('Failed to detect agents');
          console.error('Agent detection failed:', agentsResult.reason);
        }

        // Apply CWD
        if (cwdResult.status === 'fulfilled' && !restoredProjectPath) {
          useUiStore.getState().setCwd(cwdResult.value as string);
        } else if (cwdResult.status === 'rejected') {
          console.error('CWD fetch failed:', cwdResult.reason);
        }

        // Apply environment
        if (envResult.status === 'fulfilled') {
          const activeProject = useUiStore.getState().openProjects.find((project) => project.path === useUiStore.getState().cwd);
          if (!activeProject && envResult.value.runtime !== 'local') {
            useUiStore.setState({ environment: envResult.value.runtime });
          }
        } else {
          console.error('Environment detection failed:', envResult.reason);
        }

        // Apply sessions
        if (sessionsResult.status === 'fulfilled') {
          useSessionStore.getState().setSessions(sessionsResult.value);
        } else {
          console.error('Sessions fetch failed:', sessionsResult.reason);
        }
      } finally {
        useAgentStore.getState().setDetecting(false);
      }
    }
    init().catch(console.error);
  }, []);

  const openProjects = useUiStore((s) => s.openProjects);

  // Load workspaces when CWD or openProjects change and listen for status updates
  useEffect(() => {
    const projectPaths = openProjects.length > 0 ? openProjects.map((p) => p.path) : cwd ? [cwd] : [];
    const projects = projectPaths;
    if (projects.length === 0) return;
    let cancelled = false;

    const restoreWorkspaceChats = async (workspace: Workspace, sessions: WorkspaceSession[]) => {
      const chatStore = useChatStore.getState();
      const thinking = workspace.thinking ?? useAgentStore.getState().selectedThinking;

      for (const workspaceSession of sessions) {
        const existingTask = Array.from(chatStore.tasks.values()).find(
          (task) => task.workspaceId === workspace.id && task.sessionId === workspaceSession.sessionId,
        );
        if (existingTask) continue;

        const session = await window.api.invoke('sessions:get', { id: workspaceSession.sessionId }) as Session | null;
        if (!session || cancelled) continue;

        const messages = await window.api.invoke('sessions:messages', { id: workspaceSession.sessionId }) as SessionMessage[];
        if (cancelled) return;

        const taskId = workspaceSession.taskId ?? crypto.randomUUID();
        const restoredMessages = messages
          .map((message) => restoreSessionMessage(message))
          .filter((message): message is NonNullable<typeof message> => !!message);

        chatStore.createTask({
          id: taskId,
          title: workspaceSession.label || session.title || workspace.name,
          agentId: (session.agentId || workspace.agentId) as any,
          model: normalizeClaudeCodeModel(session.model || workspace.model, session.agentId || workspace.agentId),
          mode: session.mode,
          thinking,
          cwd: workspace.worktreePath,
          sessionId: session.id,
          workspaceId: workspace.id,
        });

        chatStore.restoreMessages(taskId, restoredMessages);
        chatStore.setTaskStatus(taskId, workspace.status === 'error' ? 'error' : 'done');
      }
    };

    (async () => {
      try {
        // Phase 1: Fetch workspace lists in parallel — render UI immediately
        const listsPerProject = await Promise.all(
          projects.map((repo) => window.api.invoke('workspace:list', { parentRepo: repo }) as Promise<Workspace[]>),
        );
        if (cancelled) return;
        const allWorkspaces = listsPerProject.flat();
        useWorkspaceStore.getState().setWorkspaces(allWorkspaces);

        // Phase 2: Load operations (needed for sidebar); groups load in background
        await useWorkspaceStore.getState().loadWorkspaceOperations();
        if (cancelled) return;

        // Fire-and-forget: group loading + chat restoration don't block sidebar render
        Promise.all(
          allWorkspaces.map((ws) => useWorkspaceGroupStore.getState().loadGroupForWorkspace(ws.id)),
        ).catch(() => {});

        const activeId = useWorkspaceStore.getState().activeWorkspaceId;
        if (activeId) {
          const activeWs = allWorkspaces.find((ws) => ws.id === activeId);
          if (activeWs) {
            window.api.invoke('workspace:list-chats', { workspaceId: activeWs.id }).then(async (raw) => {
              if (cancelled) return;
              const sessions = raw as WorkspaceSession[];
              useWorkspaceStore.getState().setWorkspaceSessions(activeWs.id, sessions);
              await restoreWorkspaceChats(activeWs, sessions);
            }).catch(() => {});
          }
        }

        // Phase 3 (background): Sync outcomes and refresh — doesn't block UI
        if (!cancelled) {
          Promise.allSettled(
            projects.map((repo) => window.api.invoke('workspace:sync-outcomes', { parentRepo: repo })),
          ).then(async () => {
            if (cancelled) return;
            const freshLists = await Promise.all(
              projects.map((repo) => window.api.invoke('workspace:list', { parentRepo: repo }) as Promise<Workspace[]>),
            );
            if (!cancelled) {
              useWorkspaceStore.getState().setWorkspaces(freshLists.flat());
            }
          }).catch(() => {});
        }
      } catch {
        // Workspace restore is best-effort.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd, openProjects]);

  // Lazily load chat sessions when the active workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      void useWorkspaceStore.getState().ensureSessionsLoaded(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const unsub = window.api.on('workspace:status', (data: unknown) => {
      const { workspaceId, status } = data as { workspaceId: string; status: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { status: status as any });
    });
    const unsubOutcome = window.api.on('workspace:outcome', (data: unknown) => {
      const { workspaceId, outcome } = data as { workspaceId: string; outcome: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { outcome: outcome as any });
    });
    const unsubCheckpoint = window.api.on('workspace:checkpoint', (data: unknown) => {
      const { workspaceId, checkpoint } = data as any;
      useWorkspaceStore.getState().addCheckpoint(workspaceId, checkpoint);
    });
    const unsubUpdated = window.api.on('workspace:updated', (data: unknown) => {
      const { workspaceId, branch, name, worktreePath } = data as {
        workspaceId: string;
        branch?: string;
        name?: string;
        worktreePath?: string;
      };
      const updates: Record<string, unknown> = {};
      if (branch != null) updates.branch = branch;
      if (name != null) updates.name = name;
      if (worktreePath) updates.worktreePath = worktreePath;
      useWorkspaceStore.getState().updateWorkspace(workspaceId, updates);
      if (worktreePath) {
        useChatStore.getState().updateWorkspaceTaskCwd(workspaceId, worktreePath);
      }
    });
    const unsubCreated = window.api.on('workspace:created', (data: unknown) => {
      const { workspace } = data as { workspace: Workspace };
      useWorkspaceStore.getState().addWorkspace(workspace);
      void useWorkspaceGroupStore.getState().loadGroupForWorkspace(workspace.id);
    });
    const unsubDeleted = window.api.on('workspace:deleted', (data: unknown) => {
      const { workspaceId } = data as { workspaceId: string };
      useWorkspaceGroupStore.getState().removeWorkspace(workspaceId);
      applyWorkspaceDeleted(workspaceId);
    });
    const lastOperationState = new Map<string, string>();
    const unsubOperation = window.api.on('workspace:operation', (data: unknown) => {
      const operation = data as WorkspaceOperation;
      const key = `${operation.status}:${operation.stage}:${operation.error ?? ''}`;
      if (lastOperationState.get(operation.id) !== key) {
        lastOperationState.set(operation.id, key);
        const toastId = `workspace-operation:${operation.id}`;
        if (operation.status === 'running') {
          toast.loading(operation.message, { id: toastId });
        } else if (operation.status === 'completed') {
          toast.success(operation.message, { id: toastId });
        } else if (operation.status === 'cancelled') {
          toast('Archive cancelled', { id: toastId });
        } else {
          toast.error(operation.error ?? operation.message, { id: toastId });
        }
      }

      const workspaceExists = useWorkspaceStore.getState().workspaces.has(operation.workspaceId);
      if (workspaceExists || operation.status !== 'completed') {
        useWorkspaceStore.getState().setWorkspaceOperation(operation);
      }
    });
    return () => {
      unsub();
      unsubOutcome();
      unsubCheckpoint();
      unsubUpdated();
      unsubCreated();
      unsubDeleted();
      unsubOperation();
    };
  }, []);

  // Sync model selector and mode when the active workspace changes so each
  // workspace shows and uses its own agent/model/mode in the chat input.
  // When switching away from a workspace (back to standalone chats), restore
  // the global config defaults so workspace settings don't leak out.
  useEffect(() => {
    if (activeWorkspaceId) {
      const workspace = useWorkspaceStore.getState().workspaces.get(activeWorkspaceId);
      if (!workspace?.agentId) return;
      const workspaceMode = workspace.mode ?? 'act';
      const fallbackThinking = useAgentStore.getState().selectedThinking;
      const selection = getModeSelection(workspace, workspaceMode, fallbackThinking);
      useUiStore.getState().setMode(workspaceMode);
      useAgentStore.getState().syncToWorkspace(selection.agentId, selection.model, selection.thinking);

      // Lazily restore chats for this workspace if not already loaded
      const existingSessions = useWorkspaceStore.getState().workspaceSessions.get(activeWorkspaceId);
      if (!existingSessions) {
        (async () => {
          const sessions = await window.api.invoke('workspace:list-chats', { workspaceId: activeWorkspaceId }) as WorkspaceSession[];
          useWorkspaceStore.getState().setWorkspaceSessions(activeWorkspaceId, sessions);
          const chatStore = useChatStore.getState();
          const thinking = workspace.thinking ?? useAgentStore.getState().selectedThinking;
          for (const workspaceSession of sessions) {
            const existingTask = Array.from(chatStore.tasks.values()).find(
              (task) => task.workspaceId === workspace.id && task.sessionId === workspaceSession.sessionId,
            );
            if (existingTask) continue;
            const session = await window.api.invoke('sessions:get', { id: workspaceSession.sessionId }) as Session | null;
            if (!session) continue;
            const messages = await window.api.invoke('sessions:messages', { id: workspaceSession.sessionId }) as SessionMessage[];
            const taskId = workspaceSession.taskId ?? crypto.randomUUID();
            const restoredMessages = messages
              .map((message) => restoreSessionMessage(message))
              .filter((message): message is NonNullable<typeof message> => !!message);
            chatStore.createTask({
              id: taskId,
              title: workspaceSession.label || session.title || workspace.name,
              agentId: (session.agentId || workspace.agentId) as any,
              model: normalizeClaudeCodeModel(session.model || workspace.model, session.agentId || workspace.agentId),
              mode: session.mode,
              thinking,
              cwd: workspace.worktreePath,
              sessionId: session.id,
              workspaceId: workspace.id,
            });
            chatStore.restoreMessages(taskId, restoredMessages);
            chatStore.setTaskStatus(taskId, workspace.status === 'error' ? 'error' : 'done');
          }
        })().catch(console.error);
      }
    } else {
      // Restore global defaults when leaving a workspace
      window.api.invoke('config:get').then((raw) => {
        const config = raw as FluxConfig;
        const agentStore = useAgentStore.getState();
        const agentId = (config.defaultAgent || agentStore.selectedAgentId) as AgentId;
        const model = config.defaultModel || agentStore.selectedModel;
        agentStore.syncToWorkspace(agentId, model, config.defaultThinking);
        useUiStore.getState().setMode(config.defaultMode ?? 'act');
      }).catch(() => {});
    }
  }, [activeWorkspaceId]);

  // Keep workspace mode persisted and switch selector to that mode's stored
  // agent/model/thinking whenever the user toggles plan/act.
  useEffect(() => {
    let prevMode = useUiStore.getState().mode;
    const unsub = useUiStore.subscribe((state) => {
      if (state.mode === prevMode) return;
      prevMode = state.mode;

      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (!wsId) return;
      const workspace = useWorkspaceStore.getState().workspaces.get(wsId);
      if (!workspace) return;

      const selection = getModeSelection(
        workspace,
        state.mode,
        useAgentStore.getState().selectedThinking,
      );
      const modePatch = buildModeSelectionPatch(state.mode, selection);

      useWorkspaceStore.getState().updateWorkspace(wsId, {
        mode: state.mode,
        agentId: selection.agentId,
        model: selection.model,
        thinking: selection.thinking,
        ...modePatch,
      });
      window.api.invoke('workspace:update', {
        workspaceId: wsId,
        mode: state.mode,
        agentId: selection.agentId,
        model: selection.model,
        thinking: selection.thinking,
        ...modePatch,
      }).catch(() => {});

      useAgentStore.getState().syncToWorkspace(
        selection.agentId,
        selection.model,
        selection.thinking,
      );
    });
    return unsub;
  }, []);

  // Persist agent/model/thinking changes back to the active workspace so
  // switching away and back remembers the user's last selection.
  useEffect(() => {
    let prev = {
      agentId: useAgentStore.getState().selectedAgentId,
      model: useAgentStore.getState().selectedModel,
      thinking: useAgentStore.getState().selectedThinking,
    };
    const unsub = useAgentStore.subscribe((state) => {
      const current = {
        agentId: state.selectedAgentId,
        model: state.selectedModel,
        thinking: state.selectedThinking,
      };
      if (
        current.agentId === prev.agentId &&
        current.model === prev.model &&
        current.thinking === prev.thinking
      ) {
        return;
      }
      prev = current;
      const wsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (!wsId) return;
      const mode = useUiStore.getState().mode;
      const modePatch = buildModeSelectionPatch(mode, current);
      useWorkspaceStore.getState().updateWorkspace(wsId, {
        agentId: current.agentId,
        model: current.model,
        thinking: current.thinking,
        ...modePatch,
      });
      window.api.invoke('workspace:update', {
        workspaceId: wsId,
        agentId: current.agentId,
        model: current.model,
        thinking: current.thinking,
        ...modePatch,
      }).catch(() => {});
    });
    return unsub;
  }, []);

  // When the user changes agent/model/thinking during an active run, wait for
  // the selection to settle before restarting the task on the new selection.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearPendingRestart = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const scheduleSelectionRestart = () => {
      const chat = useChatStore.getState();
      const taskId = chat.activeTaskId;
      if (!taskId) {
        clearPendingRestart();
        return;
      }

      const task = chat.tasks.get(taskId);
      const selection = useAgentStore.getState();
      const selectionChanged = !!task && (
        task.agentId !== selection.selectedAgentId
        || task.model !== selection.selectedModel
        || task.thinking !== selection.selectedThinking
      );

      if (!task || task.status !== 'running' || !task.sessionId || !selectionChanged) {
        clearPendingRestart();
        return;
      }

      clearPendingRestart();
      timeout = setTimeout(async () => {
        const currentChat = useChatStore.getState();
        if (currentChat.activeTaskId !== taskId) return;
        const currentTask = currentChat.tasks.get(taskId);
        const currentSelection = useAgentStore.getState();
        if (
          !currentTask
          || currentTask.status !== 'running'
          || !currentTask.sessionId
          || (
            currentTask.agentId === currentSelection.selectedAgentId
            && currentTask.model === currentSelection.selectedModel
            && currentTask.thinking === currentSelection.selectedThinking
          )
        ) {
          return;
        }

        try {
          if (currentTask.thinking !== currentSelection.selectedThinking) {
            currentChat.setTaskThinking(taskId, currentSelection.selectedThinking);
          }
          if (
            currentTask.agentId !== currentSelection.selectedAgentId
            || currentTask.model !== currentSelection.selectedModel
          ) {
            currentChat.switchTaskAgent(
              taskId,
              currentSelection.selectedAgentId,
              currentSelection.selectedModel,
              { stopActiveRun: false },
            );
          }
          currentChat.setTaskStatus(taskId, 'running');
          const result = await window.api.invoke('task:restart', {
            taskId,
            agentId: currentSelection.selectedAgentId,
            model: currentSelection.selectedModel,
            mode: currentTask.mode,
            thinking: currentSelection.selectedThinking,
            cwd: currentTask.cwd,
          }) as { taskId: string; session: Session };
          if (result?.session) {
            currentChat.setTaskSessionId(taskId, result.session.id);
            useSessionStore.getState().upsertSession(result.session);
          }
        } catch (error) {
          currentChat.setTaskStatus(taskId, 'error');
          toast.error(error instanceof Error ? error.message : 'Failed to restart task with the new selection');
        }
      }, MODEL_SWITCH_RESPAWN_DELAY_MS);
    };

    let previousSelection = {
      agentId: useAgentStore.getState().selectedAgentId,
      model: useAgentStore.getState().selectedModel,
      thinking: useAgentStore.getState().selectedThinking,
    };

    const unsubscribeSelection = useAgentStore.subscribe((state) => {
      const nextSelection = {
        agentId: state.selectedAgentId,
        model: state.selectedModel,
        thinking: state.selectedThinking,
      };
      if (
        nextSelection.agentId === previousSelection.agentId
        && nextSelection.model === previousSelection.model
        && nextSelection.thinking === previousSelection.thinking
      ) {
        return;
      }
      previousSelection = nextSelection;
      scheduleSelectionRestart();
    });

    return () => {
      clearPendingRestart();
      unsubscribeSelection();
    };
  }, []);

  // Fetch git info when CWD changes — single IPC round trip
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    (async () => {
      // Sync backend cwd so git checks run against the correct directory
      await window.api.invoke('cwd:set', { cwd }).catch(() => {});
      if (cancelled) return;

      try {
        const info = await window.api.invoke('git:info') as { isRepo: boolean; branch: string | null; upstream: string | null; dirty: boolean };
        if (cancelled) return;
        useUiStore.getState().setIsGitRepo(info.isRepo);
        useUiStore.getState().setGitBranch(info.branch);
        useUiStore.getState().setGitUpstream(info.upstream);
        useUiStore.getState().setGitDirty(info.dirty);
      } catch {
        if (!cancelled) {
          useUiStore.getState().setIsGitRepo(false);
          useUiStore.getState().setGitBranch(null);
          useUiStore.getState().setGitUpstream(null);
          useUiStore.getState().setGitDirty(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  // Apply theme
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Auto-persist agent selections (debounced).
  // When a workspace is active, agent/model changes are scoped to that workspace
  // instead of leaking into the global config.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let prev = {
      agent: useAgentStore.getState().selectedAgentId,
      model: useAgentStore.getState().selectedModel,
      thinking: useAgentStore.getState().selectedThinking,
    };
    const unsub = useAgentStore.subscribe((state) => {
      const cur = { agent: state.selectedAgentId, model: state.selectedModel, thinking: state.selectedThinking };
      if (cur.agent === prev.agent && cur.model === prev.model && cur.thinking === prev.thinking) return;
      const snapshot = prev;
      prev = cur;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const wsId = useWorkspaceStore.getState().activeWorkspaceId;

        // Always update global config defaults so new workspaces inherit the latest selection
        const configPartial: Partial<FluxConfig> = {};
        if (cur.agent !== snapshot.agent) configPartial.defaultAgent = cur.agent;
        if (cur.model !== snapshot.model) configPartial.defaultModel = cur.model;
        // Only persist thinking globally when no workspace is active
        if (!wsId && cur.thinking !== snapshot.thinking) {
          configPartial.defaultThinking = cur.thinking;
        }
        if (Object.keys(configPartial).length > 0) {
          window.api.invoke('config:set', configPartial).catch(() => {});
        }

        // When a workspace is active, persist agent/model/thinking to the workspace DB
        if (wsId) {
          const wsPartial: {
            workspaceId: string;
            agentId?: string;
            model?: string;
            thinking?: string;
            planAgentId?: string;
            planModel?: string;
            planThinking?: string;
            actAgentId?: string;
            actModel?: string;
            actThinking?: string;
          } = { workspaceId: wsId };
          if (cur.agent !== snapshot.agent) wsPartial.agentId = cur.agent;
          if (cur.model !== snapshot.model) wsPartial.model = cur.model;
          if (cur.thinking !== snapshot.thinking) wsPartial.thinking = cur.thinking;
          const mode = useUiStore.getState().mode;
          if (mode === 'plan' || mode === 'ask' || mode === 'architect') {
            wsPartial.planAgentId = cur.agent;
            wsPartial.planModel = cur.model;
            wsPartial.planThinking = cur.thinking;
          } else {
            wsPartial.actAgentId = cur.agent;
            wsPartial.actModel = cur.model;
            wsPartial.actThinking = cur.thinking;
          }
          if (wsPartial.agentId || wsPartial.model || wsPartial.thinking) {
            window.api.invoke('workspace:update', wsPartial).catch(() => {});
            useWorkspaceStore.getState().updateWorkspace(wsId, {
              ...(wsPartial.agentId ? { agentId: wsPartial.agentId } : {}),
              ...(wsPartial.model ? { model: wsPartial.model } : {}),
              ...(wsPartial.thinking ? { thinking: wsPartial.thinking as any } : {}),
              ...(wsPartial.planAgentId ? { planAgentId: wsPartial.planAgentId as AgentId } : {}),
              ...(wsPartial.planModel ? { planModel: wsPartial.planModel } : {}),
              ...(wsPartial.planThinking ? { planThinking: wsPartial.planThinking as ThinkingLevel } : {}),
              ...(wsPartial.actAgentId ? { actAgentId: wsPartial.actAgentId as AgentId } : {}),
              ...(wsPartial.actModel ? { actModel: wsPartial.actModel } : {}),
              ...(wsPartial.actThinking ? { actThinking: wsPartial.actThinking as ThinkingLevel } : {}),
            });
          }
        }
      }, 300);
    });
    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  // Auto-persist multi-project state
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let prevOpenProjects = useUiStore.getState().openProjects;
    let prevCwd = useUiStore.getState().cwd;
    let prevGroupId = useUiStore.getState().activeGroupId;
    const unsub = useUiStore.subscribe((state) => {
      if (
        state.openProjects === prevOpenProjects &&
        state.cwd === prevCwd &&
        state.activeGroupId === prevGroupId
      ) return;
      prevOpenProjects = state.openProjects;
      prevCwd = state.cwd;
      prevGroupId = state.activeGroupId;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const partial: Partial<FluxConfig> = {};
        if (state.openProjects.length > 0) {
          partial.openProjects = state.openProjects;
        }

        if (state.cwd) {
          partial.activeProjectPath = state.cwd;
        }
        if (state.activeGroupId) {
          partial.lastActiveGroupId = state.activeGroupId;
        }
        if (Object.keys(partial).length > 0) {
          window.api.invoke('config:set', partial).catch(() => {});
        }
      }, 500);
    });
    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  // Auto-persist mode (global config only) and autoApprove changes.
  // Workspace-scoped mode persistence is handled by the mode subscription above
  // (lines that call updateWorkspace + workspace:update on mode change).
  useEffect(() => {
    let prevMode = useUiStore.getState().mode;
    let prevAutoApprove = useUiStore.getState().autoApprove;
    const unsub = useUiStore.subscribe((state) => {
      if (state.mode !== prevMode) {
        prevMode = state.mode;
        const wsId = useWorkspaceStore.getState().activeWorkspaceId;
        if (!wsId) {
          window.api.invoke('config:set', { defaultMode: state.mode }).catch(() => {});
        }
      }
      if (state.autoApprove !== prevAutoApprove) {
        prevAutoApprove = state.autoApprove;
        window.api.invoke('config:set', { autoApprove: state.autoApprove }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  // Auto-persist viewMode changes to config
  useEffect(() => {
    let prev = useUiStore.getState().viewMode;
    const unsub = useUiStore.subscribe((state) => {
      if (state.viewMode !== prev) {
        prev = state.viewMode;
        window.api.invoke('config:set', { viewMode: state.viewMode }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  // Open project handler
  const openProject = useCallback(async (projectPath?: string, options?: { isSSH?: boolean; sshHost?: string }) => {
    if (options?.isSSH && options.sshHost && projectPath) {
      try {
        const { host, cwd: remoteCwd } = await connectToSshWorkspace(options.sshHost, projectPath);
        // Add as unified open project
        useUiStore.getState().addOpenProject({
          path: remoteCwd,
          name: remoteCwd.split('/').pop() || remoteCwd,
          isSSH: true,
          sshHost: host,
          environment: 'ssh',
        });
        useUiStore.getState().setActiveProject(remoteCwd);
        const project = createRecentProject(remoteCwd, { isSSH: true, sshHost: host });
        await rememberRecentProject(project);
        return;
      } catch {
        useUiStore.getState().setOverlay('connect-remote');
        return;
      }
    }

    let targetPath = projectPath;
    if (!targetPath) {
      const picked = await window.api.invoke('cwd:pick') as string | null;
      if (!picked) return;
      targetPath = picked;
    } else {
      await window.api.invoke('cwd:set', { cwd: targetPath });
    }

    useUiStore.getState().addOpenProject(targetPath);
    useUiStore.getState().setActiveProject(targetPath);
    const project = createRecentProject(targetPath);
    await rememberRecentProject(project);
  }, []);

  // Cycle helpers
  const cycleModel = useCallback(() => {
    const { dynamicModels, selectedModel, agents, selectedAgentId } = useAgentStore.getState();
    const modelIds = dynamicModels.length > 0
      ? dynamicModels.map((m) => m.id)
      : agents.find((a) => a.id === selectedAgentId)?.models ?? [];
    if (modelIds.length === 0) return;
    const idx = modelIds.indexOf(selectedModel);
    useAgentStore.getState().setSelectedModel(modelIds[(idx + 1) % modelIds.length]);
  }, []);

  const thinkingLevels = useMemo(() => ['disabled', 'low', 'medium', 'high', 'xhigh'] as const, []);
  const cycleThinking = useCallback(() => {
    const current = useAgentStore.getState().selectedThinking;
    const idx = thinkingLevels.indexOf(current);
    useAgentStore.getState().setSelectedThinking(thinkingLevels[(idx + 1) % thinkingLevels.length]);
  }, [thinkingLevels]);

  // New tab helper
  const createNewTab = useCallback(() => {
    const { selectedAgentId: agent, selectedModel: model, selectedThinking: thinking } = useAgentStore.getState();
    const workspaceStore = useWorkspaceStore.getState();
    const activeWorkspace = workspaceStore.activeWorkspaceId
      ? workspaceStore.workspaces.get(workspaceStore.activeWorkspaceId)
      : null;
    const taskId = crypto.randomUUID();
    useChatStore.getState().createTask({
      id: taskId,
      title: 'New task',
      agentId: (activeWorkspace?.agentId as any) ?? agent,
      model: activeWorkspace?.model ?? model,
      mode: useUiStore.getState().mode,
      thinking,
      cwd: activeWorkspace?.worktreePath ?? (useUiStore.getState().cwd || '.'),
      workspaceId: activeWorkspace?.id,
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'b') { e.preventDefault(); useUiStore.getState().toggleSidebar(); }
      // Toggle view mode: Cmd+Shift+B
      if (meta && e.shiftKey && e.key === 'B') { e.preventDefault(); useUiStore.getState().toggleViewMode(); }
      if (meta && !e.shiftKey && e.key === 't') { e.preventDefault(); createNewTab(); }
      if (meta && e.key === 'w') { e.preventDefault(); const tid = useChatStore.getState().activeTaskId; if (tid) useChatStore.getState().closeTab(tid); }
      if (meta && e.shiftKey && e.key === 'D') { e.preventDefault(); useUiStore.getState().toggleTheme(); }
      if (meta && e.key === 'k') { e.preventDefault(); useUiStore.getState().setOverlay('command-palette'); }
      if (meta && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.workspacePanelOpen && ui.workspacePanelTab === 'files') {
          ui.setWorkspacePanelOpen(false);
        } else {
          ui.openWorkspacePanelTab('files');
        }
      }
      if (meta && !e.shiftKey && e.key === 'p') {
        e.preventDefault();
        useUiStore.getState().setOverlay('quick-open');
      }
      if (meta && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        useUiStore.getState().setOverlay('search-files');
      }
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); useUiStore.getState().toggleTerminal(); }

      // Cmd+1-9: switch between workspaces first, then standalone chats
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const wsStore = useWorkspaceStore.getState();
        const chatStore = useChatStore.getState();
        const wsList = Array.from(wsStore.workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        const standaloneTasks = Array.from(chatStore.tasks.values()).filter((t) => !t.workspaceId);
        const unified = [...wsList.map((ws) => ({ type: 'ws' as const, id: ws.id })), ...standaloneTasks.map((t) => ({ type: 'chat' as const, id: t.id }))];
        if (idx < unified.length) {
          const item = unified[idx];
          if (item.type === 'ws') {
            wsStore.setActiveWorkspace(item.id);
            // Update active project to match workspace's parent repo
            const workspace = wsStore.workspaces.get(item.id);
            if (workspace) {
              useUiStore.getState().setActiveProject(workspace.parentRepo);
            }
            // Select the most recent task for this workspace
            const wsTask = Array.from(chatStore.tasks.values())
              .filter((t) => t.workspaceId === item.id)
              .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
            if (wsTask) chatStore.setActiveTask(wsTask.id);
          } else {
            wsStore.setActiveWorkspace(null);
            chatStore.setActiveTask(item.id);
          }
        }
      }

      // Cmd+Shift+] / Cmd+Shift+[ to cycle tabs
      if (meta && e.shiftKey && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        const { tabOrder: order, activeTaskId: current } = useChatStore.getState();
        if (order.length > 1 && current) {
          const curIdx = order.indexOf(current);
          const nextIdx = e.key === ']'
            ? (curIdx + 1) % order.length
            : (curIdx - 1 + order.length) % order.length;
          useChatStore.getState().setActiveTask(order[nextIdx]);
        }
      }

      // Cycle model: Ctrl/Cmd+Shift+M
      if (meta && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        cycleModel();
      }
      // Cycle thinking: Ctrl/Cmd+Shift+T
      if (meta && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        cycleThinking();
      }
      // Toggle mode: Ctrl/Cmd+Shift+P
      if (meta && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        useUiStore.getState().toggleMode();
      }
      // Open agent selector: Ctrl/Cmd+Shift+A
      if (meta && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        useUiStore.getState().setOverlay('agent-selector');
      }
      // Zoom in: Cmd/Ctrl + =
      if (meta && !e.shiftKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        window.api.invoke('zoom:get').then((current) => {
          const next = Math.min(2.5, (current as number) + 0.1);
          window.api.invoke('zoom:set', { level: next });
        });
      }
      // Zoom out: Cmd/Ctrl + -
      if (meta && !e.shiftKey && e.key === '-') {
        e.preventDefault();
        window.api.invoke('zoom:get').then((current) => {
          const next = Math.max(0.5, (current as number) - 0.1);
          window.api.invoke('zoom:set', { level: next });
        });
      }
      // Reset zoom: Cmd/Ctrl + 0
      if (meta && !e.shiftKey && e.key === '0') {
        e.preventDefault();
        window.api.invoke('zoom:set', { level: 1.0 });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createNewTab, cycleModel, cycleThinking]);

  if (!appReady) {
    return <div className="flex h-screen items-center justify-center bg-bg-primary" />;
  }

  return (
    <div className="premium-shell flex h-screen min-w-[400px] bg-bg-primary text-text-primary">
      <div className="chrome-window flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence>{sidebarOpen && <Sidebar />}</AnimatePresence>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden">
              <div className="relative flex min-w-0 flex-1 flex-col">
                  <div className="chrome-stage flex min-h-0 flex-1 flex-col overflow-hidden">
                    {viewMode === 'product' ? (
                      <ProductView />
                    ) : (
                    <>
                    <TabBar />
                    {activeWorkspaceId && <WorkspaceActionBar />}

                    {/* Not-a-git-repo banner — hide when a workspace is active since it has its own git context */}
                    {!isGitRepo && cwd && !activeWorkspaceId && (
                      <div className="mx-auto mt-4 w-full max-w-[600px] px-6">
                        <div className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
                          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-text-primary">
                              Not a Git repository
                            </p>
                            <p className="mt-1 text-[13px] text-text-secondary">
                              <span className="font-mono text-[13px] text-text-tertiary">{cwd}</span>{' '}
                              is not a git repository. Workspaces require git to create isolated branches.
                            </p>
                            <p className="mt-2 text-[13px] text-text-tertiary">
                              Initialize it by running:
                            </p>
                            <code className="mt-1 inline-block rounded bg-bg-secondary px-2 py-1 font-mono text-[13px] text-text-secondary">
                              git init
                            </code>
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                onClick={() => openProject()}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-secondary px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-bg-hover transition-colors"
                              >
                                <FolderOpen size={13} />
                                Open Different Folder
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-1 min-h-0 overflow-hidden">
                      <div className="relative flex-1 min-w-0 flex flex-col">
                        {explorerOpen && <FileExplorer />}
                        {changesPanelOpen && <ChangesPanel />}
                        <ErrorBoundary>
                          {hasTasks ? (
                            <MessageList />
                          ) : sessionsLoading ? (
                            <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
                              Restoring sessions…
                            </div>
                          ) : (
                            <WelcomeScreen onOpenProject={openProject} />
                          )}
                        </ErrorBoundary>
                        <div className="shrink-0">
                          <div className="mx-auto w-full max-w-[1024px] px-5 pb-2 pt-2">
                            <LiveRunHeader />
                            <TodoBar />
                            <ErrorBoundary>
                              <ChatInput focused />
                            </ErrorBoundary>
                          </div>
                        </div>
                      </div>
                      <WorkspaceSidePanel />
                    </div>
                    </>
                    )}
                  </div>
              </div>
            </div>

            <ErrorBoundary
              fallback={
                <div className="flex shrink-0 flex-col border-t border-border bg-bg-secondary h-[120px] items-center justify-center text-xs text-text-tertiary gap-1">
                  <span>Terminal failed to load.</span>
                  <button onClick={() => window.location.reload()} className="underline">
                    Reload
                  </button>
                </div>
              }
            >
              <BottomPanel hidden={!bottomPanelOpen} />
            </ErrorBoundary>

            <StatusLine />
          </div>
        </div>
      </div>

      {/* Merge dialog rendered at top level */}
      {mergingWorkspace && (
        <MergeDialog
          workspace={mergingWorkspace}
          onClose={() => useWorkspaceStore.getState().closeMerge()}
        />
      )}
      {committingWorkspace && (
        <CommitDialog
          workspace={committingWorkspace}
          onClose={() => useWorkspaceStore.getState().closeCommit()}
        />
      )}
      <QuickOpen />
      <SearchFiles />
      {linkingWorkspaceId && <LinkWorkspaceDialog />}
    </div>
  );
}
