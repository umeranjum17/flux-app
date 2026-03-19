/**
 * Zustand store for terminal tab state.
 * All terminal tab management lives here so any component or keyboard shortcut
 * can interact with terminals without imperative refs.
 */
import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';
import {
  createManagedTerminal,
  mountTerminal as mountManagedTerminal,
  disposeTerminal,
  disposeAll,
  writeToTerminal,
  fitTerminal,
  focusTerminal,
  setAllTheme,
} from '../lib/terminal-manager';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TerminalTab {
  id: string;
  title: string;
  shellName?: string;
  workspaceId?: string;
  workspaceBranch?: string;
  cwd?: string;
  /** Split panes within this tab. null = single pane (default). */
  splits?: SplitPane[];
}

export interface SplitPane {
  terminalId: string;
  /** Fraction of the tab width (0-1). First pane + second pane = 1. */
  size: number;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  counter: number;
  /** Whether the search bar is visible */
  searchOpen: boolean;
  searchQuery: string;

  // Actions
  createTerminal(opts?: {
    workspaceId?: string;
    workspaceName?: string;
    workspaceBranch?: string;
    shell?: string;
    /** If provided, the command is written to the PTY after shell init. */
    command?: string;
    /** Use a specific terminal ID instead of auto-generating one. */
    id?: string;
  }): Promise<string | null>;
  closeTerminal(id: string): void;
  setActiveTab(id: string): void;
  focusActive(): void;
  openWorkspaceTerminal(workspaceId: string): void;
  /** Split the active terminal tab horizontally */
  splitTerminal(): Promise<string | null>;
  setSplitSize(tabId: string, index: number, size: number): void;
  closeSplit(tabId: string, terminalId: string): void;
  setSearchOpen(open: boolean): void;
  setSearchQuery(query: string): void;
  updateTabCwd(id: string, cwd: string): void;
  updateTabTitle(id: string, title: string, shellName?: string): void;
  removeTab(id: string): void;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useTerminalStore = create<TerminalState>()(
  immer((set, get) => ({
    tabs: [],
    activeId: null,
    counter: 0,
    searchOpen: false,
    searchQuery: '',

    async createTerminal(opts) {
      const counter = get().counter + 1;
      const id = opts?.id ?? `term-${counter}`;
      const placeholderTitle = opts?.workspaceName ?? `Terminal ${counter}`;

      set((s) => {
        s.counter = counter;
        s.tabs.push({ id, title: placeholderTitle, workspaceId: opts?.workspaceId, workspaceBranch: opts?.workspaceBranch });
        s.activeId = id;
      });
      useUiStore.getState().setActiveTerminalId(id);

      try {
        const cwd = opts?.workspaceId ? undefined : useUiStore.getState().cwd;
        const result = await window.api.invoke('terminal:create', {
          id,
          cwd,
          workspaceId: opts?.workspaceId,
          shell: opts?.shell,
          command: opts?.command,
        }) as { id: string; shellName: string };

        set((s) => {
          const tab = s.tabs.find((t) => t.id === id);
          if (tab) {
            tab.shellName = result.shellName;
            tab.title = opts?.workspaceName || result.shellName || placeholderTitle;
          }
        });

        const theme = useUiStore.getState().theme;
        const managed = await createManagedTerminal(id, theme);
        mountManagedTerminal(managed, `terminal-${id}`);

        return id;
      } catch (err) {
        console.error('[terminal-store] Failed to create terminal:', err);
        set((s) => {
          s.tabs = s.tabs.filter((t) => t.id !== id);
          if (s.activeId === id) s.activeId = s.tabs[0]?.id ?? null;
        });
        return null;
      }
    },

    closeTerminal(id) {
      void window.api.invoke('terminal:kill', { id });
      disposeTerminal(id);
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.id !== id);
        if (s.activeId === id) {
          s.activeId = s.tabs.length > 0 ? s.tabs[s.tabs.length - 1].id : null;
        }
      });
    },

    setActiveTab(id) {
      set((s) => { s.activeId = id; });
      useUiStore.getState().setActiveTerminalId(id);
      requestAnimationFrame(() => focusTerminal(id));
    },

    focusActive() {
      const { activeId } = get();
      if (activeId) focusTerminal(activeId);
    },

    openWorkspaceTerminal(workspaceId) {
      useUiStore.getState().setBottomPanelOpen(true);
      const existing = get().tabs.find((t) => t.workspaceId === workspaceId);
      if (existing) {
        get().setActiveTab(existing.id);
        return;
      }
      const workspaces = useWorkspaceStore.getState().workspaces;
      const ws = workspaces.get(workspaceId);
      if (ws) {
        get().createTerminal({
          workspaceId,
          workspaceName: ws.name,
          workspaceBranch: ws.branch,
        }).catch(() => {});
      }
    },

    async splitTerminal() {
      const { activeId, tabs } = get();
      if (!activeId) return null;
      const tab = tabs.find((t) => t.id === activeId || t.splits?.some((s) => s.terminalId === activeId));
      if (!tab) return null;

      // Create a new terminal for the split
      const counter = get().counter + 1;
      const splitId = `term-${counter}`;
      set((s) => { s.counter = counter; });

      try {
        const cwd = tab.workspaceId ? undefined : useUiStore.getState().cwd;
        const result = await window.api.invoke('terminal:create', {
          id: splitId,
          cwd,
          workspaceId: tab.workspaceId,
        }) as { id: string; shellName: string };

        const theme = useUiStore.getState().theme;
        const managed = await createManagedTerminal(splitId, theme);

        set((s) => {
          const t = s.tabs.find((x) => x.id === tab.id);
          if (!t) return;
          if (!t.splits) {
            // First split: convert single pane to split layout
            t.splits = [
              { terminalId: t.id, size: 0.5 },
              { terminalId: splitId, size: 0.5 },
            ];
          } else {
            // Add another split, redistribute sizes evenly
            const count = t.splits.length + 1;
            const size = 1 / count;
            t.splits.forEach((sp) => { sp.size = size; });
            t.splits.push({ terminalId: splitId, size });
          }
          s.activeId = splitId;
        });

        mountManagedTerminal(managed, `terminal-${splitId}`);
        return splitId;
      } catch (err) {
        console.error('[terminal-store] Failed to split terminal:', err);
        return null;
      }
    },

    setSplitSize(tabId, index, size) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab?.splits || !tab.splits[index]) return;
        const other = index === 0 ? 1 : 0;
        tab.splits[index].size = size;
        tab.splits[other].size = 1 - size;
      });
    },

    closeSplit(tabId, terminalId) {
      void window.api.invoke('terminal:kill', { id: terminalId });
      disposeTerminal(terminalId);
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab?.splits) return;
        tab.splits = tab.splits.filter((sp) => sp.terminalId !== terminalId);
        if (tab.splits.length <= 1) {
          // Back to single pane
          tab.splits = undefined;
        } else {
          // Redistribute
          const size = 1 / tab.splits.length;
          tab.splits.forEach((sp) => { sp.size = size; });
        }
        if (s.activeId === terminalId) {
          s.activeId = tab.id;
        }
      });
    },

    setSearchOpen(open) {
      set((s) => { s.searchOpen = open; });
    },

    setSearchQuery(query) {
      set((s) => { s.searchQuery = query; });
    },

    updateTabCwd(id, cwd) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) tab.cwd = cwd;
      });
    },

    updateTabTitle(id, title, shellName) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) {
          tab.title = title;
          if (shellName) tab.shellName = shellName;
        }
      });
    },

    removeTab(id) {
      disposeTerminal(id);
      set((s) => {
        s.tabs = s.tabs.filter((t) => t.id !== id);
        if (s.activeId === id) {
          s.activeId = s.tabs[0]?.id ?? null;
        }
      });
    },
  })),
);

// ── IPC listeners (set up once at module load) ──────────────────────────────

let ipcSetup = false;

export function setupTerminalIpc(): () => void {
  if (ipcSetup) return () => {};
  ipcSetup = true;

  const cleanupData = window.api.on('terminal:data', (...args: unknown[]) => {
    const { id, data } = args[0] as { id: string; data: string };
    writeToTerminal(id, data);
  });

  const cleanupExit = window.api.on('terminal:exit', (...args: unknown[]) => {
    const { id } = args[0] as { id: string };
    useTerminalStore.getState().removeTab(id);
  });

  const cleanupIntegration = window.api.on('terminal:integration', (...args: unknown[]) => {
    const { id, event } = args[0] as { id: string; event: { type: string; cwd?: string } };
    if (event.type === 'cwd' && event.cwd) {
      useTerminalStore.getState().updateTabCwd(id, event.cwd);
    }
  });

  // Agent-spawned visible terminals: open a terminal tab with the command
  const cleanupAgentCreate = window.api.on('terminal:agent-create', (...args: unknown[]) => {
    const { id, command, workspaceId, workspaceName } = args[0] as {
      id: string; command: string; cwd: string; workspaceId?: string; workspaceName?: string;
    };
    useUiStore.getState().setBottomPanelOpen(true);
    useTerminalStore.getState().createTerminal({
      id,
      command,
      workspaceId,
      workspaceName: workspaceName ? `${workspaceName}: ${command.slice(0, 30)}` : command.slice(0, 40),
    }).catch((err) => {
      console.error('[terminal-store] Failed to create agent terminal:', err);
    });
  });

  const cleanupAgentKill = window.api.on('terminal:agent-kill', (...args: unknown[]) => {
    const { id } = args[0] as { id: string };
    useTerminalStore.getState().closeTerminal(id);
  });

  return () => {
    cleanupData();
    cleanupExit();
    cleanupIntegration();
    cleanupAgentCreate();
    cleanupAgentKill();
    ipcSetup = false;
  };
}

// ── Theme sync ──────────────────────────────────────────────────────────────

let themeUnsub: (() => void) | null = null;

export function setupThemeSync(): () => void {
  if (themeUnsub) return () => {};
  let prevTheme = useUiStore.getState().theme;
  themeUnsub = useUiStore.subscribe((state) => {
    if (state.theme !== prevTheme) {
      prevTheme = state.theme;
      setAllTheme(state.theme);
    }
  });
  return () => {
    themeUnsub?.();
    themeUnsub = null;
  };
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function teardownAllTerminals(): void {
  disposeAll();
}
