import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskMode } from '../lib/types';

type Overlay = 'settings' | 'agent-selector' | 'session-picker' | 'command-palette' | 'ssh-connect' | 'remote-folder-picker' | null;

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  isSSH?: boolean;
  sshHost?: string;
}

interface UiState {
  sidebarOpen: boolean;
  theme: 'dark' | 'light';
  sendKey: 'cmd+enter' | 'enter';
  mode: TaskMode;
  activeOverlay: Overlay;

  // CWD / Project
  cwd: string;
  projectName: string;

  // Git
  gitBranch: string | null;
  gitDirty: boolean;

  // File explorer
  explorerOpen: boolean;

  // Terminal
  terminalOpen: boolean;
  activeTerminalId: string | null;

  // Bottom panel mode (Warp-style)
  bottomPanelMode: 'agent' | 'terminal';

  // SSH
  sshHost: string | null;
  sshConnected: boolean;
  environment: 'local' | 'ssh';

  // Active file preview
  activeFile: { path: string; name: string } | null;

  // File mention from explorer
  pendingMention: { path: string; name: string } | null;

  // Recent projects
  recentProjects: RecentProject[];

  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  toggleTheme(): void;
  setTheme(theme: 'dark' | 'light'): void;
  setSendKey(sendKey: 'cmd+enter' | 'enter'): void;
  setMode(mode: TaskMode): void;
  toggleMode(): void;
  setOverlay(overlay: Overlay): void;
  setCwd(cwd: string): void;
  setGitBranch(branch: string | null): void;
  setGitDirty(dirty: boolean): void;
  toggleExplorer(): void;
  setExplorerOpen(open: boolean): void;
  toggleTerminal(): void;
  setTerminalOpen(open: boolean): void;
  setActiveTerminalId(id: string | null): void;
  setSshHost(host: string | null): void;
  setSshConnected(connected: boolean): void;
  setEnvironment(env: 'local' | 'ssh'): void;
  setBottomPanelMode(mode: 'agent' | 'terminal'): void;
  toggleBottomPanelMode(): void;
  setActiveFile(file: { path: string; name: string } | null): void;
  setPendingMention(mention: { path: string; name: string } | null): void;
  setRecentProjects(projects: RecentProject[]): void;
  addRecentProject(project: RecentProject): void;
}

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

export const useUiStore = create<UiState>()(
  immer((set) => ({
    sidebarOpen: true,
    theme: 'dark',
    sendKey: 'cmd+enter',
    mode: 'act',
    activeOverlay: null,
    cwd: '',
    projectName: '',
    gitBranch: null,
    gitDirty: false,
    explorerOpen: false,
    terminalOpen: false,
    activeTerminalId: null,
    bottomPanelMode: 'agent',
    sshHost: null,
    sshConnected: false,
    environment: 'local',
    activeFile: null,
    pendingMention: null,
    recentProjects: [],

    toggleSidebar() {
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      });
    },

    setSidebarOpen(open) {
      set((state) => {
        state.sidebarOpen = open;
      });
    },

    toggleTheme() {
      set((state) => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
      });
    },

    setTheme(theme) {
      set((state) => {
        state.theme = theme;
      });
    },

    setSendKey(sendKey) {
      set((state) => {
        state.sendKey = sendKey;
      });
    },

    setMode(mode) {
      set((state) => {
        state.mode = mode;
      });
    },

    toggleMode() {
      set((state) => {
        state.mode = state.mode === 'plan' ? 'act' : 'plan';
      });
    },

    setOverlay(overlay) {
      set((state) => {
        state.activeOverlay = overlay;
      });
    },

    setCwd(cwd) {
      set((state) => {
        state.cwd = cwd;
        state.projectName = basename(cwd);
        state.activeFile = null;
      });
    },

    setGitBranch(branch) {
      set((state) => {
        state.gitBranch = branch;
      });
    },

    setGitDirty(dirty) {
      set((state) => {
        state.gitDirty = dirty;
      });
    },

    toggleExplorer() {
      set((state) => {
        state.explorerOpen = !state.explorerOpen;
      });
    },

    setExplorerOpen(open) {
      set((state) => {
        state.explorerOpen = open;
      });
    },

    toggleTerminal() {
      set((state) => {
        state.terminalOpen = !state.terminalOpen;
        state.bottomPanelMode = state.terminalOpen ? 'terminal' : 'agent';
      });
    },

    setTerminalOpen(open) {
      set((state) => {
        state.terminalOpen = open;
        state.bottomPanelMode = open ? 'terminal' : 'agent';
      });
    },

    setActiveTerminalId(id) {
      set((state) => {
        state.activeTerminalId = id;
      });
    },

    setSshHost(host) {
      set((state) => {
        state.sshHost = host;
      });
    },

    setSshConnected(connected) {
      set((state) => {
        state.sshConnected = connected;
        state.environment = connected ? 'ssh' : 'local';
      });
    },

    setEnvironment(env) {
      set((state) => {
        state.environment = env;
      });
    },

    setBottomPanelMode(mode) {
      set((state) => {
        state.bottomPanelMode = mode;
        state.terminalOpen = mode === 'terminal';
      });
    },

    toggleBottomPanelMode() {
      set((state) => {
        state.bottomPanelMode = state.bottomPanelMode === 'agent' ? 'terminal' : 'agent';
        state.terminalOpen = state.bottomPanelMode === 'terminal';
      });
    },

    setActiveFile(file) {
      set((state) => {
        state.activeFile = file;
      });
    },

    setPendingMention(mention) {
      set((state) => {
        state.pendingMention = mention;
      });
    },

    setRecentProjects(projects) {
      set((state) => {
        state.recentProjects = projects;
      });
    },

    addRecentProject(project) {
      set((state) => {
        const filtered = state.recentProjects.filter((p) => p.path !== project.path);
        state.recentProjects = [project, ...filtered].slice(0, 10);
      });
    },
  })),
);
