import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { TaskMode } from '../lib/types';
import type { LiveUsageOverview, ProjectSource, RecentProject } from '../lib/ipc-api';
import { basename } from '../lib/format';

export type { ProjectSource, RecentProject } from '../lib/ipc-api';

type Overlay = 'settings' | 'agent-selector' | 'session-picker' | 'command-palette' | 'connect-remote' | 'create-folder' | 'diagnostics' | 'help' | 'quick-open' | 'search-files' | null;

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
  activeProject: ProjectSource | null;

  // Multi-project / Project Groups
  activeGroupId: string | null;
  openProjects: ProjectSource[];
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

  // Workspace view mode (list vs kanban)
  workspaceViewMode: 'list' | 'kanban';

  // Workspace detail panel (ticket view)
  detailPanelWorkspaceId: string | null;

  // Kanban project filter (null = all projects)
  kanbanProjectFilter: string | null;

  // Kanban usage panel (inline rate-limit view for kanban mode)
  kanbanUsagePanelOpen: boolean;

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
  setOpenProjects(projects: Array<ProjectSource | string>): void;
  addOpenProject(project: ProjectSource | string): void;
  removeOpenProject(project: ProjectSource | string): void;
  setActiveProject(project: ProjectSource | string): void;
  toggleProjectCollapsed(project: ProjectSource | string): void;
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
  setWorkspaceViewMode(mode: 'list' | 'kanban'): void;
  toggleWorkspaceViewMode(): void;
  openDetailPanel(workspaceId: string): void;
  closeDetailPanel(): void;
  setKanbanProjectFilter(key: string | null): void;
  setKanbanUsagePanelOpen(open: boolean): void;
  toggleKanbanUsagePanel(): void;

  // Bottom panel
  toggleBottomPanel(): void;
  setBottomPanelOpen(open: boolean): void;
  setBottomPanelTab(tab: 'terminal' | 'output'): void;
  setPendingWorkspaceTerminalId(id: string | null): void;
}

export function getProjectSourceKey(project: Pick<ProjectSource, 'path' | 'source'> & { sshHost?: string }): string {
  return project.source === 'ssh'
    ? `ssh:${project.sshHost ?? ''}:${project.path}`
    : `local:${project.path}`;
}

export function getRecentProjectKey(project: RecentProject): string {
  return getProjectSourceKey(project);
}

export function normalizeProjectSource(project: ProjectSource | string | null | undefined): ProjectSource | null {
  if (typeof project === 'string') {
    return { path: project, source: 'local' };
  }

  if (!project || typeof project.path !== 'string' || project.path.length === 0) {
    return null;
  }

  if (project.source === 'ssh') {
    return {
      path: project.path,
      source: 'ssh',
      ...(project.sshHost ? { sshHost: project.sshHost } : {}),
    };
  }

  return {
    path: project.path,
    source: 'local',
  };
}

function normalizeLegacyProjectSource(value: unknown): ProjectSource | null {
  if (typeof value === 'string') {
    return normalizeProjectSource(value);
  }

  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string') {
    return null;
  }

  const source =
    ('source' in value && value.source === 'ssh') || ('isSSH' in value && value.isSSH === true)
      ? 'ssh'
      : 'local';
  const sshHost = 'sshHost' in value && typeof value.sshHost === 'string' ? value.sshHost : undefined;

  return normalizeProjectSource({
    path: value.path,
    source,
    sshHost,
  });
}

export function normalizeProjectSources(projects: readonly unknown[] | null | undefined): ProjectSource[] {
  if (!projects) return [];

  const deduped = new Map<string, ProjectSource>();
  for (const project of projects) {
    const normalized = normalizeLegacyProjectSource(project);
    if (!normalized) continue;
    deduped.set(getProjectSourceKey(normalized), normalized);
  }

  return Array.from(deduped.values());
}

function findProjectSource(
  openProjects: readonly ProjectSource[],
  project: ProjectSource | string | null | undefined,
  activeProject: ProjectSource | null,
  sshHost: string | null,
): ProjectSource | null {
  const normalized = normalizeProjectSource(project);
  if (!normalized) return null;

  if (typeof project !== 'string') {
    return normalized;
  }

  if (activeProject?.path === project) {
    return activeProject;
  }

  if (sshHost) {
    const sshProject = openProjects.find(
      (candidate) => candidate.path === project && candidate.source === 'ssh' && candidate.sshHost === sshHost,
    );
    if (sshProject) return sshProject;
  }

  return (
    openProjects.find((candidate) => candidate.path === project && candidate.source === 'local') ||
    openProjects.find((candidate) => candidate.path === project) ||
    normalized
  );
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
    activeProject: null,
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
    workspaceViewMode: 'list',
    detailPanelWorkspaceId: null,
    kanbanProjectFilter: null,
    kanbanUsagePanelOpen: false,

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
        const order: TaskMode[] = ['plan', 'act', 'ask', 'architect', 'discovery'];
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
        if (state.activeProject?.path !== cwd) {
          state.activeProject = normalizeProjectSource(cwd);
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
        state.openProjects = normalizeProjectSources(projects);
      });
    },

    addOpenProject(project) {
      set((state) => {
        const normalized = findProjectSource(state.openProjects, project, state.activeProject, state.sshHost);
        if (!normalized) return;

        const key = getProjectSourceKey(normalized);
        if (!state.openProjects.some((candidate) => getProjectSourceKey(candidate) === key)) {
          state.openProjects = [...state.openProjects, normalized];
        }
      });
    },

    removeOpenProject(project) {
      set((state) => {
        const target = findProjectSource(state.openProjects, project, state.activeProject, state.sshHost);
        if (!target) return;

        const targetKey = getProjectSourceKey(target);
        state.openProjects = state.openProjects.filter((candidate) => getProjectSourceKey(candidate) !== targetKey);
        state.collapsedProjects.delete(targetKey);

        // If we removed the active project, switch to the first remaining one
        if (state.activeProject && getProjectSourceKey(state.activeProject) === targetKey && state.openProjects.length > 0) {
          state.activeProject = state.openProjects[0];
          state.cwd = state.openProjects[0].path;
          state.projectName = basename(state.openProjects[0].path);
          state.activeFile = null;
        } else if (state.activeProject && getProjectSourceKey(state.activeProject) === targetKey) {
          state.activeProject = null;
        }
      });
    },

    setActiveProject(project) {
      set((state) => {
        const normalized = findProjectSource(state.openProjects, project, state.activeProject, state.sshHost);
        if (!normalized) return;

        state.activeProject = normalized;
        state.cwd = normalized.path;
        state.projectName = basename(normalized.path);
        state.activeFile = null;

        const key = getProjectSourceKey(normalized);
        if (!state.openProjects.some((candidate) => getProjectSourceKey(candidate) === key)) {
          state.openProjects = [...state.openProjects, normalized];
        }
      });
    },

    toggleProjectCollapsed(project) {
      set((state) => {
        const normalized = findProjectSource(state.openProjects, project, state.activeProject, state.sshHost);
        if (!normalized) return;

        const key = getProjectSourceKey(normalized);
        if (state.collapsedProjects.has(key)) {
          state.collapsedProjects.delete(key);
        } else {
          state.collapsedProjects.add(key);
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
        const remoteProject = normalizeProjectSource({ path: cwd, source: 'ssh', sshHost: host });
        if (!remoteProject) return;

        state.sshHost = host;
        state.sshConnected = true;
        state.connectedSshHosts.add(host);
        state.environment = 'ssh';
        state.cwd = cwd;
        state.projectName = basename(cwd);
        state.activeFile = null;
        state.activeProject = remoteProject;

        const key = getProjectSourceKey(remoteProject);
        if (!state.openProjects.some((candidate) => getProjectSourceKey(candidate) === key)) {
          state.openProjects = [...state.openProjects, remoteProject];
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
            (p) => !(p.source === 'ssh' && p.sshHost === disconnectedHost),
          );
        }
        state.sshHost = null;
        state.sshConnected = false;
        state.environment = 'local';
        state.cwd = localCwd;
        state.projectName = basename(localCwd);
        state.activeFile = null;
        state.activeProject = findProjectSource(state.openProjects, localCwd, null, null);
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

    setWorkspaceViewMode(mode) {
      set((state) => {
        state.workspaceViewMode = mode;
      });
    },

    toggleWorkspaceViewMode() {
      set((state) => {
        state.workspaceViewMode = state.workspaceViewMode === 'list' ? 'kanban' : 'list';
      });
    },

    openDetailPanel(workspaceId) {
      set((state) => {
        state.detailPanelWorkspaceId = workspaceId;
      });
    },

    closeDetailPanel() {
      set((state) => {
        state.detailPanelWorkspaceId = null;
      });
    },

    setKanbanProjectFilter(key) {
      set((state) => {
        state.kanbanProjectFilter = key;
      });
    },

    setKanbanUsagePanelOpen(open) {
      set((state) => {
        state.kanbanUsagePanelOpen = open;
      });
    },

    toggleKanbanUsagePanel() {
      set((state) => {
        state.kanbanUsagePanelOpen = !state.kanbanUsagePanelOpen;
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
