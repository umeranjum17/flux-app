import { useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { TopBar } from './TopBar';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { RightSidebar } from './RightSidebar';
import { StatusLine } from './StatusLine';
import { MessageList } from '../chat/MessageList';
import { LiveRunHeader } from '../chat/LiveRunHeader';
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
import type { FluxConfig, Session, EnvironmentInfo, Workspace } from '../../lib/ipc-api';
import { useWorkspaceStore } from '../../stores/workspace';
import { WorkspaceActionBar } from '../workspace/WorkspaceActionBar';
import { CodeReviewPanel } from '../review/CodeReviewPanel';
import { MergeDialog } from '../review/MergeDialog';
import { connectToSshWorkspace, createRecentProject, rememberRecentProject } from '../../lib/workspace-state';


export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const rightSidebarOpen = useUiStore((s) => s.rightSidebarOpen);
  const bottomPanelOpen = useUiStore((s) => s.bottomPanelOpen);
  const theme = useUiStore((s) => s.theme);
  const cwd = useUiStore((s) => s.cwd);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const tasks = useChatStore((s) => s.tasks);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const mergingWorkspaceId = useWorkspaceStore((s) => s.mergingWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const termRef = useRef<TerminalPanelHandle>(null);

  const hasTasks = tasks.size > 0;
  const mergingWorkspace = mergingWorkspaceId ? workspaces.get(mergingWorkspaceId) : null;

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
    window.api.invoke('workspace:list', { parentRepo: cwd })
      .then((result: unknown) => {
        useWorkspaceStore.getState().setWorkspaces(result as Workspace[]);
      })
      .catch(() => {});
  }, [cwd]);

  useEffect(() => {
    const unsub = window.api.on('workspace:status', (data: unknown) => {
      const { workspaceId, status } = data as { workspaceId: string; status: string };
      useWorkspaceStore.getState().updateWorkspace(workspaceId, { status: status as any });
    });
    const unsubCheckpoint = window.api.on('workspace:checkpoint', (data: unknown) => {
      const { workspaceId, checkpoint } = data as any;
      useWorkspaceStore.getState().addCheckpoint(workspaceId, checkpoint);
    });
    return () => { unsub(); unsubCheckpoint(); };
  }, []);

  // Fetch git info when CWD changes
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    (async () => {
      try {
        const branch = await window.api.invoke('git:branch') as string | null;
        if (!cancelled) useUiStore.getState().setGitBranch(branch);
      } catch { if (!cancelled) useUiStore.getState().setGitBranch(null); }
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

  // Auto-persist agent selections (debounced)
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
        const partial: Partial<FluxConfig> = {};
        if (cur.agent !== snapshot.agent) partial.defaultAgent = cur.agent;
        if (cur.model !== snapshot.model) partial.defaultModel = cur.model;
        if (cur.thinking !== snapshot.thinking) partial.defaultThinking = cur.thinking;
        if (Object.keys(partial).length > 0) {
          window.api.invoke('config:set', partial).catch(() => {});
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
    const taskId = crypto.randomUUID();
    useChatStore.getState().createTask({
      id: taskId,
      title: 'New task',
      agentId: agent,
      model,
      mode: useUiStore.getState().mode,
      thinking,
      cwd: useUiStore.getState().cwd || '.',
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
      if (meta && e.key === 'e') { e.preventDefault(); useUiStore.getState().toggleRightSidebar(); }
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); useUiStore.getState().toggleBottomPanel(); }

      // Cmd+1-9: switch between workspaces first, then standalone chats
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const wsStore = useWorkspaceStore.getState();
        const chatStore = useChatStore.getState();
        const wsList = Array.from(wsStore.workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        const standaloneTasks = Array.from(chatStore.tasks.values()).filter((t) => !wsStore.workspaces.has(t.id));
        const unified = [...wsList.map((ws) => ({ type: 'ws' as const, id: ws.id })), ...standaloneTasks.map((t) => ({ type: 'chat' as const, id: t.id }))];
        if (idx < unified.length) {
          const item = unified[idx];
          if (item.type === 'ws') {
            wsStore.setActiveWorkspace(item.id);
            chatStore.setActiveTask(item.id);
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
          <ActivityBar />
          <AnimatePresence>{sidebarOpen && <Sidebar />}</AnimatePresence>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 overflow-hidden">
              <div className="relative flex min-w-0 flex-1 flex-col">
                {reviewingWorkspaceId ? (
                  <CodeReviewPanel />
                ) : (
                  <div className="chrome-stage flex min-h-0 flex-1 flex-col overflow-hidden">
                    <TabBar />
                    {activeWorkspaceId && <WorkspaceActionBar />}
                    {hasTasks ? <MessageList /> : <WelcomeScreen onOpenProject={openProject} />}
                    <div className="shrink-0">
                      <div className="mx-auto w-full max-w-[900px] px-6 py-6">
                        <LiveRunHeader />
                        <ChatInput focused />
                      </div>
                    </div>
                  </div>
                )}

                {explorerOpen && <FileExplorer />}
              </div>

              <AnimatePresence>{rightSidebarOpen && <RightSidebar />}</AnimatePresence>
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
