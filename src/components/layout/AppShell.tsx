import { useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Bot, TerminalSquare } from 'lucide-react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { StatusLine } from './StatusLine';
import { MessageList } from '../chat/MessageList';
import { LiveRunHeader } from '../chat/LiveRunHeader';
import { ChatInput } from '../input/ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { TabBar } from './TabBar';
import { FileExplorer } from '../explorer/FileExplorer';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { toast } from 'sonner';
import { useAgentStream } from '../../hooks/useAgentStream';
import { applyTheme } from '../../lib/theme';
import type { DetectedAgent } from '../../lib/types';
import type { FluxConfig, Session, EnvironmentInfo } from '../../lib/ipc-api';
import { useWorkspaceStore } from '../../stores/workspace';
import { WorkspaceDashboard } from '../workspace/WorkspaceDashboard';
import { WorkspacePanel } from '../workspace/WorkspacePanel';
import { connectToSshWorkspace, createRecentProject, rememberRecentProject } from '../../lib/workspace-state';


export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const theme = useUiStore((s) => s.theme);
  const cwd = useUiStore((s) => s.cwd);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const bottomPanelMode = useUiStore((s) => s.bottomPanelMode);
  const tasks = useChatStore((s) => s.tasks);
  const dashboardOpen = useWorkspaceStore((s) => s.dashboardOpen);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const termRef = useRef<TerminalPanelHandle>(null);

  const hasTasks = tasks.size > 0;
  const isAgent = bottomPanelMode === 'agent';

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

  // Fetch git info when CWD changes (with cancellation for stale requests)
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

  // Auto-persist agent selections (debounced to avoid startup noise)
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
    // SSH reconnection
    if (options?.isSSH && options.sshHost && projectPath) {
      try {
        const { host, cwd: remoteCwd } = await connectToSshWorkspace(options.sshHost, projectPath);
        const project = createRecentProject(remoteCwd, { isSSH: true, sshHost: host });
        await rememberRecentProject(project);
        return;
      } catch {
        // SSH reconnection failed — open SSH dialog so user can re-authenticate
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
    // Git info will be fetched by the cwd effect

    const project = createRecentProject(targetPath);
    await rememberRecentProject(project);
  }, []);

  const switchToAgent = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const switchToTerminal = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('terminal');
    requestAnimationFrame(() => termRef.current?.focusActive());
  }, []);

  // Cycle helpers for model and thinking level
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
      if (meta && e.key === 'e') { e.preventDefault(); useUiStore.getState().toggleExplorer(); }
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); useUiStore.getState().toggleBottomPanelMode(); }

      // Cmd+1-9 switch tabs
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const order = useChatStore.getState().tabOrder;
        if (idx < order.length) {
          useChatStore.getState().setActiveTask(order[idx]);
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
  }, [createNewTab]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary min-w-[400px]">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence>{sidebarOpen && <Sidebar />}</AnimatePresence>
        <div className="flex flex-col flex-1 min-w-0">
          <div className="relative flex flex-col flex-1 overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center gap-0 bg-bg-secondary/50 border-b border-border-subtle shrink-0">
              <button
                onClick={switchToAgent}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-[1.5px] transition-colors ${
                  isAgent
                    ? 'border-text-secondary text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Bot size={12} />
                Agent
              </button>
              <button
                onClick={switchToTerminal}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-[1.5px] transition-colors ${
                  !isAgent
                    ? 'border-text-secondary text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <TerminalSquare size={12} />
                Terminal
              </button>
            </div>

            {/* Content area */}
            <div className="relative flex flex-1 overflow-hidden">
              {/* Agent view */}
              <div className={`flex flex-col flex-1 min-w-0 ${isAgent ? '' : 'hidden'}`}>
                {dashboardOpen ? (
                  reviewingWorkspaceId ? (
                    <WorkspaceDashboard />
                  ) : activeWorkspaceId ? (
                    <WorkspacePanel />
                  ) : (
                    <WorkspaceDashboard />
                  )
                ) : (
                  <>
                    <TabBar />
                    {hasTasks ? <MessageList /> : <WelcomeScreen onOpenProject={openProject} />}
                    <div className="px-4 py-2.5 border-t border-border-subtle shrink-0">
                      <LiveRunHeader />
                      <ChatInput focused={isAgent} />
                    </div>
                  </>
                )}
              </div>

              {/* Terminal view */}
              <div className={`flex flex-col flex-1 min-w-0 ${isAgent ? 'hidden' : ''}`}>
                <TerminalPanel ref={termRef} visible={!isAgent} />
              </div>

              {/* File viewer overlay */}
              {explorerOpen && <FileExplorer />}
            </div>
          </div>
          <StatusLine />
        </div>
      </div>
    </div>
  );
}
