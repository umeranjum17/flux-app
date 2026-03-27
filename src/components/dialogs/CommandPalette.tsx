import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  ToggleLeft,
  PanelLeftClose,
  Sun,
  Settings,
  Bot,
  FolderOpen,
  FolderPlus,
  Search,
  Wifi,
  WifiOff,
  PanelRight,
  Terminal,
  LayoutGrid,
  Brain,
  Cpu,
} from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import type { ThinkingLevel } from '../../lib/types';
import { openLocalProject } from '../../lib/workspace-state';

interface PaletteAction {
  id: string;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  shortcut?: string;
  handler: () => void;
}

export function CommandPalette() {
  const { activeOverlay, setOverlay, toggleMode, toggleSidebar, toggleTheme } = useUiStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const open = activeOverlay === 'command-palette';

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: 'new-task',
        name: 'New Task',
        icon: Plus,
        shortcut: 'Ctrl+N',
        handler: () => {
          useChatStore.getState().setActiveTask(null);
          setOverlay(null);
        },
      },
      {
        id: 'toggle-mode',
        name: 'Toggle Plan/Act',
        icon: ToggleLeft,
        shortcut: 'Ctrl+M',
        handler: () => {
          toggleMode();
          setOverlay(null);
        },
      },
      {
        id: 'toggle-sidebar',
        name: 'Toggle Sidebar',
        icon: PanelLeftClose,
        shortcut: 'Ctrl+B',
        handler: () => {
          toggleSidebar();
          setOverlay(null);
        },
      },
      {
        id: 'toggle-theme',
        name: 'Toggle Theme',
        icon: Sun,
        handler: () => {
          toggleTheme();
          setOverlay(null);
        },
      },
      {
        id: 'settings',
        name: 'Settings',
        icon: Settings,
        shortcut: 'Ctrl+,',
        handler: () => {
          setOverlay('settings');
        },
      },
      {
        id: 'switch-agent',
        name: 'Switch Agent',
        icon: Bot,
        shortcut: 'Ctrl+Shift+A',
        handler: () => {
          setOverlay('agent-selector');
        },
      },
      {
        id: 'cycle-model',
        name: 'Cycle Model',
        icon: Cpu,
        shortcut: 'Ctrl+Shift+M',
        handler: () => {
          const { dynamicModels, selectedModel, agents, selectedAgentId } = useAgentStore.getState();
          const modelIds = dynamicModels.length > 0
            ? dynamicModels.map((m) => m.id)
            : agents.find((a) => a.id === selectedAgentId)?.models ?? [];
          if (modelIds.length > 0) {
            const idx = modelIds.indexOf(selectedModel);
            useAgentStore.getState().setSelectedModel(modelIds[(idx + 1) % modelIds.length]);
          }
          setOverlay(null);
        },
      },
      {
        id: 'cycle-thinking',
        name: 'Cycle Thinking Level',
        icon: Brain,
        shortcut: 'Ctrl+Shift+T',
        handler: () => {
          const levels: ThinkingLevel[] = ['disabled', 'low', 'medium', 'high', 'xhigh'];
          const current = useAgentStore.getState().selectedThinking;
          const idx = levels.indexOf(current);
          useAgentStore.getState().setSelectedThinking(levels[(idx + 1) % levels.length]);
          setOverlay(null);
        },
      },
      {
        id: 'quick-open',
        name: 'Quick Open File',
        icon: Search,
        shortcut: 'Ctrl+P',
        handler: () => {
          setOverlay('quick-open');
        },
      },
      {
        id: 'search-files',
        name: 'Search in Files',
        icon: Search,
        shortcut: 'Ctrl+Shift+F',
        handler: () => {
          setOverlay('search-files');
        },
      },
      {
        id: 'session-list',
        name: 'Session List',
        icon: FolderOpen,
        handler: () => {
          setOverlay('session-picker');
        },
      },
      {
        id: 'open-local-project',
        name: 'Open Local Project',
        icon: FolderOpen,
        handler: async () => {
          setOverlay(null);
          await openLocalProject();
        },
      },
      {
        id: 'create-local-project',
        name: 'Create Local Project',
        icon: FolderPlus,
        handler: () => {
          setOverlay('create-folder');
        },
      },
      {
        id: 'toggle-explorer',
        name: 'Toggle Explorer',
        icon: PanelRight,
        shortcut: 'Ctrl+E',
        handler: () => {
          setOverlay(null);
          useUiStore.getState().toggleExplorer();
        },
      },
      {
        id: 'toggle-terminal',
        name: 'Toggle Terminal',
        icon: Terminal,
        shortcut: 'Ctrl+`',
        handler: () => {
          setOverlay(null);
          useUiStore.getState().toggleTerminal();
        },
      },
      {
        id: 'open-workspaces',
        name: 'Show Workspaces',
        icon: LayoutGrid,
        handler: () => {
          setOverlay(null);
          useUiStore.getState().setSidebarOpen(true);
          useUiStore.getState().setSidebarTab('workspaces');
        },
      },
      {
        id: 'toggle-kanban',
        name: 'Toggle Kanban Board',
        icon: LayoutGrid,
        handler: () => {
          setOverlay(null);
          useUiStore.getState().toggleWorkspaceViewMode();
        },
      },
      {
        id: 'connect-ssh-project',
        name: 'Connect SSH Project',
        icon: Wifi,
        handler: () => {
          setOverlay('connect-remote');
        },
      },
      {
        id: 'ssh-disconnect',
        name: 'Disconnect SSH Project',
        icon: WifiOff,
        handler: async () => {
          setOverlay(null);
          const result = await window.api.invoke('ssh:disconnect') as { cwd?: string };
          useUiStore.getState().disconnectSsh(result?.cwd || useUiStore.getState().cwd);
        },
      },
    ],
    [setOverlay, toggleMode, toggleSidebar, toggleTheme],
  );

  const filtered = useMemo(() => {
    if (!query) return actions;
    const lower = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        a.id.toLowerCase().includes(lower),
    );
  }, [query, actions]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const handleKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setOverlay(null);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          filtered[activeIndex].handler();
        }
      }
    },
    [open, filtered, activeIndex, setOverlay],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
          onClick={() => setOverlay(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.12 }}
            className="bg-bg-elevated rounded-2xl max-w-lg w-full mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={16} className="text-text-tertiary flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
              />
            </div>

            <div className="py-1 max-h-72 overflow-y-auto">
              {filtered.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.handler}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      index === activeIndex
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <Icon size={16} className="flex-shrink-0 text-text-tertiary" />
                    <span className="flex-1 text-left">{action.name}</span>
                    {action.shortcut && (
                      <kbd className="text-xs text-text-tertiary bg-bg-primary border border-border rounded px-1.5 py-0.5 font-mono">
                        {action.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-6">No matching commands.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
