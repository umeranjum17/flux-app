import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskMode } from '../lib/types';
import type { LiveUsageOverview } from '../lib/ipc-api';

type Overlay = 'settings' | 'agent-selector' | 'session-picker' | 'command-palette' | 'connect-remote' | 'create-folder' | 'context-settings' | 'diagnostics' | 'help' | 'quick-open' | 'search-files' | null;

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  isSSH?: boolean;
  sshHost?: string;
}

export interface OpenProject {
  path: string;
  name: string;
  isSSH?: boolean;
  sshHost?: string;
  environment: 'local' | 'ssh';
}

export function getRecentProjectKey(project: RecentProject): string {
  return project.isSSH
    ? `ssh:${project.sshHost ?? ''}:${project.path}`
    : `local:${project.path}`;
}

export function getOpenProjectKey(project: OpenProject): string {
  return project.isSSH
    ? `ssh:${project.sshHost ?? ''}:${project.path}`
    : `local:${project.path}`;
}

/** Get the active project's metadata from the openProjects list */
export function getActiveOpenProject(state: { cwd: string; openProjects: OpenProject[] }): OpenProject | undefined {
  return state.openProjects.find((p) => p.path === state.cwd);
}

export function getActiveSshHost(state: { cwd: string; openProjects: OpenProject[] }): string | null {
  const activeProject = getActiveOpenProject(state);
  return activeProject?.isSSH ? activeProject.sshHost ?? null : null;
}

export function isActiveProjectSsh(state: { cwd: string; openProjects: OpenProject[] }): boolean {
  return getActiveSshHost(state) !== null;
}

interface UiState {
  sidebarOpen: boolean;
  sidebarTab: 'workspaces' | 'usage' | 'chats';
  theme: 'dark' | 'light';
  sendKey: 'cmd+enter' | 'enter';
  mode: TaskMode;
  activeOverlay: Overlay;

  // CWD / Project
  cwd: string;
  projectName: string;

  // Multi-project / Project Groups
  activeGroupId: string | null;
  openProjects: OpenProject[];
  collapsedProjects: Set<string>;

  // Git
  isGitRepo: boolean;
  gitBranch: string | null;
  gitUpstream: string | null;
  gitDirty: boolean;

  // File explorer
  explorerOpen: boolean;

  // Terminal / bottom panel
  terminalOpen: boolean;
  activeTerminalId: string | null;
  bottomPanelMode: 'agent' | 'terminal';
  bottomPanelOpen: boolean;
  bottomPanelTab: 'terminal' | 'output';

  // Pending workspace terminal request (set before panel mounts so TerminalPanel can pick it up)
  pendingWorkspaceTerminalId: string | null;

  // SSH
  sshHost: string | null;
  sshConnected: boolean;
  connectedSshHosts: Set<string>;
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

  // Workspace side panel (right side: files, search, activity/review)
  workspacePanelOpen: boolean;
  workspacePanelTab: 'files' | 'search' | 'activity';
  linkingWorkspaceId: string | null;

  // Live usage overview (shared across StatusLine / UsagePanel)
  liveOverview: LiveUsageOverview | null;

  // Smart terminal input
  inputMode: 'chat' | 'terminal';
  shellHistory: string[];
  completionModel: string;

  setLiveOverview(overview: LiveUsageOverview | null): void;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  setSidebarTab(tab: 'workspaces' | 'usage' | 'chats'): void;
  toggleTheme(): void;
  setTheme(theme: 'dark' | 'light'): void;
  setSendKey(sendKey: 'cmd+enter' | 'enter'): void;
  setMode(mode: TaskMode): void;
  toggleMode(): void;
  setOverlay(overlay: Overlay): void;
  setCwd(cwd: string): void;
  setActiveGroupId(id: string | null): void;
  setOpenProjects(projects: OpenProject[]): void;
  addOpenProject(project: string | OpenProject): void;
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
  setWorkspacePanelOpen(open: boolean): void;
  setWorkspacePanelTab(tab: 'files' | 'search' | 'activity'): void;
  toggleWorkspacePanel(): void;
  openWorkspacePanelTab(tab: 'files' | 'search' | 'activity'): void;
  setLinkingWorkspaceId(workspaceId: string | null): void;
  setInputMode(mode: 'chat' | 'terminal'): void;
  toggleInputMode(): void;
  addShellCommand(cmd: string): void;
  setCompletionModel(model: string): void;

  // Bottom panel
  toggleBottomPanel(): void;
  setBottomPanelOpen(open: boolean): void;
  setBottomPanelTab(tab: 'terminal' | 'output'): void;
  setPendingWorkspaceTerminalId(id: string | null): void;
}

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

export const useUiStore = create<UiState>()(
  immer((set, get) => ({
    sidebarOpen: false,
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
    pendingWorkspaceTerminalId: null,
    sshHost: null,
    sshConnected: false,
    connectedSshHosts: new Set(),
    environment: 'local',
    activeFile: null,
    pendingMention: null,
    recentProjects: [],
    autoApprove: false,
    autoApproveTools: ['Read', 'Glob', 'Grep', 'Bash'],
    fileActivityPanelOpenContexts: new Set(),
    workspacePanelOpen: false,
    workspacePanelTab: 'activity' as const,
    linkingWorkspaceId: null,
    liveOverview: null,
    inputMode: 'chat',
    shellHistory: [],
    completionModel: 'haiku',

    setLiveOverview(overview) {
      set((state) => {
        state.liveOverview = overview;
      });
    },

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
      if (get().mode === mode) return;
      set((state) => {
        state.mode = mode;
      });
    },

    toggleMode() {
      set((state) => {
        const order: TaskMode[] = ['plan', 'act', 'ask', 'architect'];
        const idx = order.indexOf(state.mode);
        state.mode = order[(idx + 1) % order.length];
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

    addOpenProject(project) {
      set((state) => {
        const entry: OpenProject = typeof project === 'string'
          ? { path: project, name: basename(project), environment: 'local' }
          : project;
        if (!state.openProjects.some((p) => p.path === entry.path)) {
          state.openProjects = [...state.openProjects, entry];
        }
      });
    },

    removeOpenProject(path) {
      set((state) => {
        const removed = state.openProjects.find((p) => p.path === path);
        state.openProjects = state.openProjects.filter((p) => p.path !== path);
        state.collapsedProjects.delete(path);
        // If we removed an SSH project, remove it from connectedSshHosts if no other project uses that host
        if (removed?.isSSH && removed.sshHost) {
          const hostStillUsed = state.openProjects.some((p) => p.isSSH && p.sshHost === removed.sshHost);
          if (!hostStillUsed) {
            state.connectedSshHosts.delete(removed.sshHost);
          }
        }
        // If we removed the active project, switch to the first remaining one
        if (state.cwd === path && state.openProjects.length > 0) {
          const next = state.openProjects[0];
          state.cwd = next.path;
          state.projectName = basename(next.path);
          state.activeFile = null;
          // Derive SSH state from new active project
          if (next.isSSH && next.sshHost) {
            state.sshHost = next.sshHost;
            state.sshConnected = true;
            state.environment = 'ssh';
          } else {
            state.sshHost = null;
            state.sshConnected = false;
            state.environment = 'local';
          }
        }
      });
    },

    setActiveProject(path) {
      set((state) => {
        state.cwd = path;
        state.projectName = basename(path);
        state.activeFile = null;
        const existing = state.openProjects.find((p) => p.path === path);
        if (!existing) {
          state.openProjects = [...state.openProjects, { path, name: basename(path), environment: 'local' }];
        }
        // Derive SSH state from the project we're switching to
        const project = existing ?? state.openProjects[state.openProjects.length - 1];
        if (project.isSSH && project.sshHost) {
          state.sshHost = project.sshHost;
          state.sshConnected = true;
          state.environment = 'ssh';
        } else {
          state.sshHost = null;
          state.sshConnected = false;
          state.environment = 'local';
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
        if (!state.bottomPanelOpen) {
          state.bottomPanelOpen = true;
          state.bottomPanelTab = 'terminal';
          state.bottomPanelMode = 'terminal';
          state.terminalOpen = true;
          return;
        }
        if (state.bottomPanelTab !== 'terminal') {
          state.bottomPanelTab = 'terminal';
          state.bottomPanelMode = 'terminal';
          state.terminalOpen = true;
          return;
        }
        state.bottomPanelOpen = false;
        state.bottomPanelMode = 'agent';
        state.terminalOpen = false;
      });
    },

    setTerminalOpen(open) {
      set((state) => {
        state.terminalOpen = open;
        state.bottomPanelOpen = open;
        state.bottomPanelMode = open ? 'terminal' : 'agent';
        if (open) state.bottomPanelTab = 'terminal';
      });
    },

    setActiveTerminalId(id) {
      set((state) => {
        state.activeTerminalId = id;
      });
    },

    setBottomPanelMode(mode) {
      set((state) => {
        state.bottomPanelMode = mode;
        state.terminalOpen = mode === 'terminal';
        state.bottomPanelTab = mode === 'terminal' ? 'terminal' : 'output';
      });
    },

    toggleBottomPanelMode() {
      set((state) => {
        state.bottomPanelMode = state.bottomPanelMode === 'agent' ? 'terminal' : 'agent';
        state.terminalOpen = state.bottomPanelMode === 'terminal';
        state.bottomPanelTab = state.bottomPanelMode === 'terminal' ? 'terminal' : 'output';
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
        const projectKey = getRecentProjectKey(project);
        const filtered = state.recentProjects.filter((p) => getRecentProjectKey(p) !== projectKey);
        state.recentProjects = [project, ...filtered].slice(0, 10);
      });
    },

    connectSsh(host, cwd) {
      set((state) => {
        state.sshHost = host;
        state.sshConnected = true;
        state.connectedSshHosts.add(host);
        state.environment = 'ssh';
        state.cwd = cwd;
        state.projectName = basename(cwd);
        state.activeFile = null;
        // Add as an open project if not already present
        if (!state.openProjects.some((p) => p.path === cwd)) {
          state.openProjects = [...state.openProjects, {
            path: cwd,
            name: basename(cwd),
            isSSH: true,
            sshHost: host,
            environment: 'ssh',
          }];
        }
      });
    },

    disconnectSsh(localCwd) {
      set((state) => {
        const disconnectedHost = state.sshHost;
        if (disconnectedHost) {
          state.connectedSshHosts.delete(disconnectedHost);
          // Remove SSH projects for this host from openProjects
          state.openProjects = state.openProjects.filter(
            (p) => !(p.isSSH && p.sshHost === disconnectedHost),
          );
        }
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

    setWorkspacePanelOpen(open) {
      set((state) => {
        state.workspacePanelOpen = open;
      });
    },

    setWorkspacePanelTab(tab) {
      set((state) => {
        state.workspacePanelTab = tab;
      });
    },

    toggleWorkspacePanel() {
      set((state) => {
        state.workspacePanelOpen = !state.workspacePanelOpen;
      });
    },

    openWorkspacePanelTab(tab) {
      set((state) => {
        state.workspacePanelTab = tab;
        state.workspacePanelOpen = true;
      });
    },

    setLinkingWorkspaceId(workspaceId) {
      set((state) => {
        state.linkingWorkspaceId = workspaceId;
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
        state.terminalOpen = state.bottomPanelOpen && state.bottomPanelTab === 'terminal';
      });
    },

    setBottomPanelOpen(open) {
      set((state) => {
        state.bottomPanelOpen = open;
        state.terminalOpen = open && state.bottomPanelTab === 'terminal';
      });
    },

    setBottomPanelTab(tab) {
      set((state) => {
        state.bottomPanelTab = tab;
        state.bottomPanelMode = tab === 'terminal' ? 'terminal' : 'agent';
        state.terminalOpen = state.bottomPanelOpen && tab === 'terminal';
      });
    },

    setPendingWorkspaceTerminalId(id) {
      set((state) => {
        state.pendingWorkspaceTerminalId = id;
      });
    },

  })),
);
