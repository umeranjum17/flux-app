import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskMode } from '../lib/types';

type Overlay = 'settings' | 'agent-selector' | 'session-picker' | 'command-palette' | 'ssh-connect' | 'remote-folder-picker' | 'create-folder' | 'context-settings' | 'diagnostics' | 'help' | null;

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  isSSH?: boolean;
  sshHost?: string;
}

interface UiState {
  sidebarOpen: boolean;
  sidebarTab: 'workspaces' | 'search' | 'usage' | 'explorer';
  theme: 'dark' | 'light';
  sendKey: 'cmd+enter' | 'enter';
  mode: TaskMode;
  activeOverlay: Overlay;

  // CWD / Project
  cwd: string;
  projectName: string;

  // Multi-project / Project Groups
  activeGroupId: string | null;
  openProjects: string[];
  collapsedProjects: Set<string>;

  // Git
  isGitRepo: boolean;
  gitBranch: string | null;
  gitUpstream: string | null;
  gitDirty: boolean;

  // File explorer
  explorerOpen: boolean;

  // Terminal
  terminalOpen: boolean;
  activeTerminalId: string | null;

  // Bottom panel mode (Warp-style)
  bottomPanelMode: 'agent' | 'terminal';

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

  // File activity panel (per workspace/task)
  fileActivityPanelOpenContexts: Set<string>;

  // Smart terminal input
  inputMode: 'chat' | 'terminal';
  shellHistory: string[];
  completionModel: string;

  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  setSidebarTab(tab: 'workspaces' | 'search' | 'usage' | 'explorer'): void;
  toggleTheme(): void;
  setTheme(theme: 'dark' | 'light'): void;
  setSendKey(sendKey: 'cmd+enter' | 'enter'): void;
  setMode(mode: TaskMode): void;
  toggleMode(): void;
  setOverlay(overlay: Overlay): void;
  setCwd(cwd: string): void;
  setActiveGroupId(id: string | null): void;
  setOpenProjects(projects: string[]): void;
  addOpenProject(path: string): void;
  removeOpenProject(path: string): void;
  setActiveProject(path: string): void;
  toggleProjectCollapsed(path: string): void;
  setIsGitRepo(isRepo: boolean): void;
  setGitBranch(branch: string | null): void;
  setGitUpstream(upstream: string | null): void;
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
  setFileActivityPanelOpen(open: boolean, contextKey: string): void;
  toggleFileActivityPanel(contextKey: string): void;
  setInputMode(mode: 'chat' | 'terminal'): void;
  toggleInputMode(): void;
  addShellCommand(cmd: string): void;
  setCompletionModel(model: string): void;

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
    sidebarTab: 'workspaces',
    theme: 'dark',
    sendKey: 'cmd+enter',
    mode: 'act',
    activeOverlay: null,
    cwd: '',
    projectName: '',
    activeGroupId: null,
    openProjects: [],
    collapsedProjects: new Set(),
    isGitRepo: true,
    gitBranch: null,
    gitUpstream: null,
    gitDirty: false,
    explorerOpen: false,
    terminalOpen: false,
    activeTerminalId: null,
    bottomPanelMode: 'agent',
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
    fileActivityPanelOpenContexts: new Set(),
    inputMode: 'chat',
    shellHistory: [],
    completionModel: 'haiku',

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
        // Only auto-add when no projects are open yet (first-time setup)
        if (cwd && state.openProjects.length === 0) {
          state.openProjects = [cwd];
        }
      });
    },

    setActiveGroupId(id) {
      set((state) => {
        state.activeGroupId = id;
      });
    },

    setOpenProjects(projects) {
      set((state) => {
        state.openProjects = projects;
      });
    },

    addOpenProject(path) {
      set((state) => {
        if (!state.openProjects.includes(path)) {
          state.openProjects = [...state.openProjects, path];
        }
      });
    },

    removeOpenProject(path) {
      set((state) => {
        state.openProjects = state.openProjects.filter((p) => p !== path);
        state.collapsedProjects.delete(path);
        // If we removed the active project, switch to the first remaining one
        if (state.cwd === path && state.openProjects.length > 0) {
          state.cwd = state.openProjects[0];
          state.projectName = basename(state.openProjects[0]);
          state.activeFile = null;
        }
      });
    },

    setActiveProject(path) {
      set((state) => {
        state.cwd = path;
        state.projectName = basename(path);
        state.activeFile = null;
        if (!state.openProjects.includes(path)) {
          state.openProjects = [...state.openProjects, path];
        }
      });
    },

    toggleProjectCollapsed(path) {
      set((state) => {
        if (state.collapsedProjects.has(path)) {
          state.collapsedProjects.delete(path);
        } else {
          state.collapsedProjects.add(path);
        }
      });
    },

    setIsGitRepo(isRepo) {
      set((state) => {
        state.isGitRepo = isRepo;
      });
    },

    setGitBranch(branch) {
      set((state) => {
        state.gitBranch = branch;
      });
    },

    setGitUpstream(upstream) {
      set((state) => {
        state.gitUpstream = upstream;
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

    setFileActivityPanelOpen(open, contextKey) {
      set((state) => {
        if (open) {
          state.fileActivityPanelOpenContexts.add(contextKey);
        } else {
          state.fileActivityPanelOpenContexts.delete(contextKey);
        }
      });
    },

    toggleFileActivityPanel(contextKey) {
      set((state) => {
        if (state.fileActivityPanelOpenContexts.has(contextKey)) {
          state.fileActivityPanelOpenContexts.delete(contextKey);
        } else {
          state.fileActivityPanelOpenContexts.add(contextKey);
        }
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
