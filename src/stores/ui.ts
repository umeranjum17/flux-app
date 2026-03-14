import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskMode } from '../lib/types';

type Overlay = 'settings' | 'agent-selector' | 'session-picker' | 'command-palette' | 'ssh-connect' | 'remote-folder-picker' | 'context-settings' | 'diagnostics' | 'help' | null;

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  isSSH?: boolean;
  sshHost?: string;
}

interface UiState {
  sidebarOpen: boolean;
  sidebarTab: 'chat' | 'search' | 'usage';
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

  // Right sidebar (file explorer)
  rightSidebarOpen: boolean;
  rightSidebarTab: 'files' | 'changes' | 'checks';

  // Bottom panel
  bottomPanelOpen: boolean;
  bottomPanelTab: 'setup' | 'run' | 'terminal';

  // SSH
  sshHost: string | null;
  sshConnected: boolean;
  environment: 'local' | 'ssh' | 'wsl';

  // Active file preview
  activeFile: { path: string; name: string } | null;

  // File mention from explorer
  pendingMention: { path: string; name: string } | null;

  // Recent projects
  recentProjects: RecentProject[];

  // Auto-approve
  autoApprove: boolean;
  autoApproveTools: string[];

  // Smart terminal input
  inputMode: 'chat' | 'terminal';
  shellHistory: string[];
  completionModel: string;

  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  setSidebarTab(tab: 'chat' | 'search' | 'usage'): void;
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
  setEnvironment(env: 'local' | 'ssh' | 'wsl'): void;
  setBottomPanelMode(mode: 'agent' | 'terminal'): void;
  toggleBottomPanelMode(): void;
  setActiveFile(file: { path: string; name: string } | null): void;
  setPendingMention(mention: { path: string; name: string } | null): void;
  setRecentProjects(projects: RecentProject[]): void;
  addRecentProject(project: RecentProject): void;
  connectSsh(host: string, cwd: string): void;
  disconnectSsh(localCwd: string): void;
  setAutoApprove(enabled: boolean): void;
  toggleAutoApprove(): void;
  setAutoApproveTools(tools: string[]): void;
  setInputMode(mode: 'chat' | 'terminal'): void;
  toggleInputMode(): void;
  addShellCommand(cmd: string): void;
  setCompletionModel(model: string): void;

  // Right sidebar
  toggleRightSidebar(): void;
  setRightSidebarOpen(open: boolean): void;
  setRightSidebarTab(tab: 'files' | 'changes' | 'checks'): void;

  // Bottom panel
  toggleBottomPanel(): void;
  setBottomPanelOpen(open: boolean): void;
  setBottomPanelTab(tab: 'setup' | 'run' | 'terminal'): void;
}

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

export const useUiStore = create<UiState>()(
  immer((set) => ({
    sidebarOpen: true,
    sidebarTab: 'chat',
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
    rightSidebarOpen: true,
    rightSidebarTab: 'files',
    bottomPanelOpen: false,
    bottomPanelTab: 'terminal',
    sshHost: null,
    sshConnected: false,
    environment: 'local',
    activeFile: null,
    pendingMention: null,
    recentProjects: [],
    autoApprove: false,
    autoApproveTools: ['Read', 'Glob', 'Grep', 'Bash'],
    inputMode: 'chat',
    shellHistory: [],
    completionModel: 'gpt-4o-mini',

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

    setSidebarTab(tab) {
      set((state) => {
        state.sidebarTab = tab;
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

    connectSsh(host, cwd) {
      set((state) => {
        state.sshHost = host;
        state.sshConnected = true;
        state.environment = 'ssh';
        state.cwd = cwd;
        state.projectName = basename(cwd);
        state.activeFile = null;
      });
    },

    disconnectSsh(localCwd) {
      set((state) => {
        state.sshHost = null;
        state.sshConnected = false;
        state.environment = 'local';
        state.cwd = localCwd;
        state.projectName = basename(localCwd);
        state.activeFile = null;
      });
    },

    setAutoApprove(enabled) {
      set((state) => {
        state.autoApprove = enabled;
      });
    },

    toggleAutoApprove() {
      set((state) => {
        state.autoApprove = !state.autoApprove;
      });
    },

    setAutoApproveTools(tools) {
      set((state) => {
        state.autoApproveTools = tools;
      });
    },

    setInputMode(mode) {
      set((state) => {
        state.inputMode = mode;
      });
    },

    toggleInputMode() {
      set((state) => {
        state.inputMode = state.inputMode === 'chat' ? 'terminal' : 'chat';
      });
    },

    addShellCommand(cmd) {
      set((state) => {
        state.shellHistory = [cmd, ...state.shellHistory.filter((c) => c !== cmd)].slice(0, 20);
      });
    },

    setCompletionModel(model) {
      set((state) => {
        state.completionModel = model;
      });
    },

    toggleRightSidebar() {
      set((state) => {
        state.rightSidebarOpen = !state.rightSidebarOpen;
      });
    },

    setRightSidebarOpen(open) {
      set((state) => {
        state.rightSidebarOpen = open;
      });
    },

    setRightSidebarTab(tab) {
      set((state) => {
        state.rightSidebarTab = tab;
      });
    },

    toggleBottomPanel() {
      set((state) => {
        state.bottomPanelOpen = !state.bottomPanelOpen;
      });
    },

    setBottomPanelOpen(open) {
      set((state) => {
        state.bottomPanelOpen = open;
      });
    },

    setBottomPanelTab(tab) {
      set((state) => {
        state.bottomPanelTab = tab;
      });
    },
  })),
);
