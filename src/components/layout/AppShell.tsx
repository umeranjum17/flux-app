import { useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Bot, TerminalSquare } from 'lucide-react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { StatusLine } from './StatusLine';
import { MessageList } from '../chat/MessageList';
import { ChatInput } from '../input/ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { FileExplorer } from '../explorer/FileExplorer';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { useAgentStream } from '../../hooks/useAgentStream';
import { applyTheme } from '../../lib/theme';
import type { DetectedAgent } from '../../lib/types';
import type { FluxConfig, Session } from '../../lib/ipc-api';

async function fetchGitInfo() {
  try {
    const branch = await window.api.invoke('git:branch') as string | null;
    useUiStore.getState().setGitBranch(branch);
  } catch {
    useUiStore.getState().setGitBranch(null);
  }
  try {
    const status = await window.api.invoke('git:status') as { dirty: boolean };
    useUiStore.getState().setGitDirty(status.dirty);
  } catch {
    useUiStore.getState().setGitDirty(false);
  }
}

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const theme = useUiStore((s) => s.theme);
  const cwd = useUiStore((s) => s.cwd);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const bottomPanelMode = useUiStore((s) => s.bottomPanelMode);
  const tasks = useChatStore((s) => s.tasks);
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
        } catch {
          // config loading failed
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
        } catch {
          // agent detection failed
        }

        try {
          const cwdResult = await window.api.invoke('cwd:get') as string;
          useUiStore.getState().setCwd(cwdResult);
        } catch {}

        try {
          const sessions = await window.api.invoke('sessions:list') as Session[];
          useSessionStore.getState().setSessions(sessions);
        } catch {}
      } finally {
        useAgentStore.getState().setDetecting(false);
      }
    }
    init().catch(console.error);
  }, []);

  // Fetch git info when CWD changes
  useEffect(() => {
    if (cwd) fetchGitInfo();
  }, [cwd]);

  // Apply theme
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Open project handler
  const openProject = useCallback(async (projectPath?: string) => {
    let targetPath = projectPath;
    if (!targetPath) {
      const picked = await window.api.invoke('cwd:pick') as string | null;
      if (!picked) return;
      targetPath = picked;
    } else {
      await window.api.invoke('cwd:set', { cwd: targetPath });
    }

    useUiStore.getState().setCwd(targetPath);
    useUiStore.getState().setExplorerOpen(true);
    await fetchGitInfo();

    // Add to recent projects
    const project = {
      path: targetPath,
      name: targetPath.split('/').pop() || targetPath,
      lastOpened: Date.now(),
    };
    useUiStore.getState().addRecentProject(project);

    // Persist recent projects
    try {
      const recentProjects = useUiStore.getState().recentProjects;
      await window.api.invoke('config:set', { recentProjects });
    } catch {}
  }, []);

  const switchToAgent = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const switchToTerminal = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('terminal');
    requestAnimationFrame(() => termRef.current?.focusActive());
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'b') { e.preventDefault(); useUiStore.getState().toggleSidebar(); }
      if (meta && e.key === 't') { e.preventDefault(); useUiStore.getState().toggleMode(); }
      if (meta && e.shiftKey && e.key === 'D') { e.preventDefault(); useUiStore.getState().toggleTheme(); }
      if (meta && e.key === 'k') { e.preventDefault(); useUiStore.getState().setOverlay('command-palette'); }
      if (meta && e.key === 'e') { e.preventDefault(); useUiStore.getState().toggleExplorer(); }
      if (e.ctrlKey && e.key === '`') { e.preventDefault(); useUiStore.getState().toggleBottomPanelMode(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence>{sidebarOpen && <Sidebar />}</AnimatePresence>
        <div className="flex flex-col flex-1 min-w-0">
          {(hasTasks || explorerOpen) ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center gap-0 bg-bg-secondary border-b border-border shrink-0">
                <button
                  onClick={switchToAgent}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    isAgent
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  <Bot size={13} />
                  Agent
                </button>
                <button
                  onClick={switchToTerminal}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    !isAgent
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  <TerminalSquare size={13} />
                  Terminal
                </button>
              </div>

              {/* Content area */}
              <div className="flex flex-1 overflow-hidden">
                {/* Agent view */}
                <div className={`flex flex-col flex-1 min-w-0 ${isAgent ? '' : 'hidden'}`}>
                  <MessageList />
                  <div className="px-3 py-2 border-t border-border shrink-0">
                    <ChatInput focused={isAgent} />
                  </div>
                </div>

                {/* Terminal view */}
                <div className={`flex flex-col flex-1 min-w-0 ${isAgent ? 'hidden' : ''}`}>
                  <TerminalPanel ref={termRef} visible={!isAgent} />
                </div>

                {/* File explorer (always visible when open, regardless of tab) */}
                {explorerOpen && <FileExplorer />}
              </div>
            </div>
          ) : (
            <WelcomeScreen onOpenProject={openProject} />
          )}
          <StatusLine />
        </div>
      </div>
    </div>
  );
}
