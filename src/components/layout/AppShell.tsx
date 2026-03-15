import { useEffect, useCallback, useRef, useMemo } from 'react';
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
import { type TerminalPanelHandle } from '../terminal/TerminalPanel';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';
import { useAgentStream } from '../../hooks/useAgentStream';
import { applyTheme } from '../../lib/theme';
import type { DetectedAgent } from '../../lib/types';
import type { FluxConfig, Session, EnvironmentInfo, Workspace, SessionMessage, WorkspaceSession } from '../../lib/ipc-api';
import { useWorkspaceStore } from '../../stores/workspace';
import { WorkspaceActionBar } from '../workspace/WorkspaceActionBar';
import { CodeReviewPanel } from '../review/CodeReviewPanel';
import { ChangesPanel } from '../review/ChangesPanel';
import { FileActivityPanel } from '../review/FileActivityPanel';
import { MergeDialog } from '../review/MergeDialog';
import { connectToSshWorkspace, createRecentProject, rememberRecentProject } from '../../lib/workspace-state';
import { restoreSessionMessage } from '../../lib/session-messages';


export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const bottomPanelOpen = useUiStore((s) => s.bottomPanelOpen);
  const theme = useUiStore((s) => s.theme);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const tasks = useChatStore((s) => s.tasks);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const mergingWorkspaceId = useWorkspaceStore((s) => s.mergingWorkspaceId);
  const changesPanelOpen = useWorkspaceStore((s) => s.changesPanelOpen);
  const fileActivityContextKey = useChatStore((s) => {
    if (!s.activeTaskId) return null;
    const task = s.tasks.get(s.activeTaskId);
    return task ? (task.workspaceId ?? task.id) : null;
  });
  const fileActivityPanelOpen = useUiStore((s) =>
    fileActivityContextKey ? s.fileActivityPanelOpenContexts.has(fileActivityContextKey) : false,
  );
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const termRef = useRef<TerminalPanelHandle>(null);

  const hasTasks = tasks.size > 0;
  const mergingWorkspace = useMemo(() => {
    if (!mergingWorkspaceId) return null;
    const workspace = workspaces.get(mergingWorkspaceId);
    return workspace ? { ...workspace } : null;
  }, [mergingWorkspaceId, workspaces]);

  useAgentStream();

  // Detect agents and fetch CWD on mount
  useEffect(() => {
    async function init() {
      useAgentStore.getState().setDetecting(true);
      try {
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
        } catch (err) {
          toast.error('Failed to load configuration');
          console.error('Config load failed:', err);
        }

        try {
          const agents = await window.api.invoke('agents:detect') as DetectedAgent[];
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
            await useAgentStore.getState().fetchModels(preferredAgent.id);
            if (config?.defaultModel) {
              const availableModels = useAgentStore.getState().dynamicModels.map((model) => model.id);
              if (availableModels.includes(config.defaultModel) || preferredAgent.models.includes(config.defaultModel)) {
                useAgentStore.getState().setSelectedModel(config.defaultModel);
              }
            }
          }
        } catch (err) {
          toast.error('Failed to detect agents');
          console.error('Agent detection failed:', err);
        }

        try {
          const cwdResult = await window.api.invoke('cwd:get') as string;
          useUiStore.getState().setCwd(cwdResult);
        } catch (err) {
          console.error('CWD fetch failed:', err);
        }

        // Detect runtime environment (WSL, SSH session, etc.)
        try {
          const envInfo = await window.api.invoke('env:detect') as EnvironmentInfo;
          if (envInfo.runtime !== 'local') {
            useUiStore.getState().setEnvironment(envInfo.runtime);
          }
        } catch (err) {
          console.error('Environment detection failed:', err);
        }

        try {
          const sessions = await window.api.invoke('sessions:list') as Session[];
          useSessionStore.getState().setSessions(sessions);
        } catch (err) {
          console.error('Sessions fetch failed:', err);
        }
      } finally {
        useAgentStore.getState().setDetecting(false);
      }
    }
    init().catch(console.error);
  }, []);

  // Load workspaces when CWD changes and listen for status updates
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;

    const restoreWorkspaceChats = async (workspace: Workspace, sessions: WorkspaceSession[]) => {
      const chatStore = useChatStore.getState();
      const thinking = useAgentStore.getState().selectedThinking;

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
        chatStore.createTask({
          id: taskId,
          title: workspaceSession.label || session.title || workspace.name,
          agentId: (session.agentId || workspace.agentId) as any,
          model: session.model || workspace.model,
          mode: session.mode,
          thinking,
          cwd: workspace.worktreePath,
          sessionId: session.id,
          workspaceId: workspace.id,
        });

        for (const message of messages) {
          const restored = restoreSessionMessage(message);
          if (restored) {
            chatStore.addMessage(taskId, restored);
          }
        }

        chatStore.setTaskStatus(taskId, workspace.status === 'error' ? 'error' : 'done');
      }
    };

    (async () => {
      try {
        const result = await window.api.invoke('workspace:list', { parentRepo: cwd }) as Workspace[];
        if (cancelled) return;

        useWorkspaceStore.getState().setWorkspaces(result);

        for (const workspace of result) {
          const sessions = await window.api.invoke('workspace:list-chats', { workspaceId: workspace.id }) as WorkspaceSession[];
          if (cancelled) return;

          useWorkspaceStore.getState().setWorkspaceSessions(workspace.id, sessions);
          await restoreWorkspaceChats(workspace, sessions);
        }
      } catch {
        // Workspace restore is best-effort.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd]);

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
    return () => { unsub(); unsubOutcome(); unsubCheckpoint(); };
  }, []);

  // Sync model selector when the active workspace changes so each workspace
  // shows and uses its own agent/model in the chat input dropdown.
  // When switching away from a workspace (back to standalone chats), restore
  // the global config defaults so workspace settings don't leak out.
  useEffect(() => {
    if (activeWorkspaceId) {
      const workspace = useWorkspaceStore.getState().workspaces.get(activeWorkspaceId);
      if (!workspace?.agentId) return;
      useAgentStore.getState().syncToWorkspace(
        workspace.agentId as import('../../lib/types').AgentId,
        workspace.model,
      );
    } else {
      // Restore global defaults when leaving a workspace
      window.api.invoke('config:get').then((raw) => {
        const config = raw as FluxConfig;
        const agentStore = useAgentStore.getState();
        const agentId = (config.defaultAgent || agentStore.selectedAgentId) as import('../../lib/types').AgentId;
        const model = config.defaultModel || agentStore.selectedModel;
        agentStore.syncToWorkspace(agentId, model);
      }).catch(() => {});
    }
  }, [activeWorkspaceId]);

  // Fetch git info when CWD changes
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    (async () => {
      // Check if the folder is a git repository first
      try {
        const isRepo = await window.api.invoke('git:is-repo') as boolean;
        if (!cancelled) useUiStore.getState().setIsGitRepo(isRepo);
        if (!isRepo) {
          // Not a git repo — clear git state and stop
          useUiStore.getState().setGitBranch(null);
          useUiStore.getState().setGitUpstream(null);
          useUiStore.getState().setGitDirty(false);
          return;
        }
      } catch {
        if (!cancelled) useUiStore.getState().setIsGitRepo(false);
        return;
      }

      try {
        const branch = await window.api.invoke('git:branch') as string | null;
        if (!cancelled) useUiStore.getState().setGitBranch(branch);
      } catch { if (!cancelled) useUiStore.getState().setGitBranch(null); }
      try {
        const upstream = await window.api.invoke('git:upstream') as string | null;
        if (!cancelled) useUiStore.getState().setGitUpstream(upstream);
      } catch { if (!cancelled) useUiStore.getState().setGitUpstream(null); }
      try {
        const status = await window.api.invoke('git:status') as { dirty: boolean };
        if (!cancelled) useUiStore.getState().setGitDirty(status.dirty);
      } catch { if (!cancelled) useUiStore.getState().setGitDirty(false); }
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

        // Thinking is always global
        if (cur.thinking !== snapshot.thinking) {
          window.api.invoke('config:set', { defaultThinking: cur.thinking } as Partial<FluxConfig>).catch(() => {});
        }

        // Agent/model changes are scoped to the workspace when one is active
        if (wsId) {
          const wsPartial: { workspaceId: string; agentId?: string; model?: string } = { workspaceId: wsId };
          if (cur.agent !== snapshot.agent) wsPartial.agentId = cur.agent;
          if (cur.model !== snapshot.model) wsPartial.model = cur.model;
          if (wsPartial.agentId || wsPartial.model) {
            window.api.invoke('workspace:update', wsPartial).catch(() => {});
            useWorkspaceStore.getState().updateWorkspace(wsId, {
              ...(wsPartial.agentId ? { agentId: wsPartial.agentId } : {}),
              ...(wsPartial.model ? { model: wsPartial.model } : {}),
            });
          }
        } else {
          const partial: Partial<FluxConfig> = {};
          if (cur.agent !== snapshot.agent) partial.defaultAgent = cur.agent;
          if (cur.model !== snapshot.model) partial.defaultModel = cur.model;
          if (Object.keys(partial).length > 0) {
            window.api.invoke('config:set', partial).catch(() => {});
          }
        }
      }, 300);
    });
    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  // Auto-persist mode and autoApprove changes
  useEffect(() => {
    let prevMode = useUiStore.getState().mode;
    let prevAutoApprove = useUiStore.getState().autoApprove;
    const unsub = useUiStore.subscribe((state) => {
      if (state.mode !== prevMode) {
        prevMode = state.mode;
        window.api.invoke('config:set', { defaultMode: state.mode }).catch(() => {});
      }
      if (state.autoApprove !== prevAutoApprove) {
        prevAutoApprove = state.autoApprove;
        window.api.invoke('config:set', { autoApprove: state.autoApprove }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  // Open project handler
  const openProject = useCallback(async (projectPath?: string, options?: { isSSH?: boolean; sshHost?: string }) => {
    if (options?.isSSH && options.sshHost && projectPath) {
      try {
        const { host, cwd: remoteCwd } = await connectToSshWorkspace(options.sshHost, projectPath);
        const project = createRecentProject(remoteCwd, { isSSH: true, sshHost: host });
        await rememberRecentProject(project);
        return;
      } catch {
        useUiStore.getState().setOverlay('ssh-connect');
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

    useUiStore.getState().setCwd(targetPath);
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

  const thinkingLevels = useMemo(() => ['low', 'medium', 'high', 'xhigh'] as const, []);
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
      if (meta && !e.shiftKey && e.key === 't') { e.preventDefault(); createNewTab(); }
      if (meta && e.key === 'w') { e.preventDefault(); const tid = useChatStore.getState().activeTaskId; if (tid) useChatStore.getState().closeTab(tid); }
      if (meta && e.shiftKey && e.key === 'D') { e.preventDefault(); useUiStore.getState().toggleTheme(); }
      if (meta && e.key === 'k') { e.preventDefault(); useUiStore.getState().setOverlay('command-palette'); }
      if (meta && e.key === 'e') {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (ui.sidebarTab === 'explorer' && ui.sidebarOpen) {
          ui.setSidebarTab('workspaces');
        } else {
          ui.setSidebarTab('explorer');
          if (!ui.sidebarOpen) ui.setSidebarOpen(true);
        }
      }
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); useUiStore.getState().toggleBottomPanel(); }

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

  return (
    <div className="premium-shell flex h-screen min-w-[400px] bg-bg-primary text-text-primary">
      <div className="chrome-window flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AnimatePresence>{sidebarOpen && <Sidebar />}</AnimatePresence>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden">
              <div className="relative flex min-w-0 flex-1 flex-col">
                {reviewingWorkspaceId ? (
                  <CodeReviewPanel />
                ) : changesPanelOpen ? (
                  <ChangesPanel />
                ) : (
                  <div className="chrome-stage flex min-h-0 flex-1 flex-col overflow-hidden">
                    <TabBar />
                    {activeWorkspaceId && <WorkspaceActionBar />}

                    {/* Not-a-git-repo banner */}
                    {!isGitRepo && cwd && (
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
                      <div className="flex-1 min-w-0 flex flex-col">
                        {hasTasks ? <MessageList /> : <WelcomeScreen onOpenProject={openProject} />}
                        <div className="shrink-0">
                          <div className="mx-auto w-full max-w-[1024px] px-5 pb-2 pt-2">
                            <LiveRunHeader />
                            <TodoBar />
                            <ChatInput focused />
                          </div>
                        </div>
                      </div>
                      {fileActivityPanelOpen && <FileActivityPanel />}
                    </div>
                  </div>
                )}

                {explorerOpen && <FileExplorer />}
              </div>
            </div>

            {bottomPanelOpen && <BottomPanel ref={termRef} />}

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
    </div>
  );
}
