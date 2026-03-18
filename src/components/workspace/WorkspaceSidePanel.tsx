import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Files, Search, FilePen, FolderOpen, FolderPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { FileTree, type TreeNode } from '../explorer/FileTree';
import { FileActivityPanel } from '../review/FileActivityPanel';

type PanelTab = 'files' | 'search' | 'activity';

const PANEL_TABS: { id: PanelTab; icon: typeof Files; label: string }[] = [
  { id: 'files', icon: Files, label: 'Files' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'activity', icon: FilePen, label: 'Activity' },
];

/**
 * Resolve the effective cwd for the workspace side panel:
 * - If a workspace is active, use its worktreePath
 * - Otherwise fall back to the global cwd
 */
function useEffectiveCwd(): string {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const globalCwd = useUiStore((s) => s.cwd);

  return useMemo(() => {
    if (activeWorkspaceId) {
      const ws = workspaces.get(activeWorkspaceId);
      if (ws?.worktreePath) return ws.worktreePath;
    }
    return globalCwd;
  }, [activeWorkspaceId, workspaces, globalCwd]);
}

export function WorkspaceSidePanel() {
  const open = useUiStore((s) => s.workspacePanelOpen);
  const activeTab = useUiStore((s) => s.workspacePanelTab);

  if (!open) return null;

  return (
    <div className="w-[280px] shrink-0 border-l border-border/50 bg-bg-surface/30 flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-border/40 px-2 py-1">
        <div className="flex items-center gap-0.5">
          {PANEL_TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => useUiStore.getState().setWorkspacePanelTab(id)}
              title={label}
              className={`sidebar-nav-icon ${activeTab === id ? 'sidebar-nav-icon-active' : ''}`}
            >
              <Icon size={14} strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <button
          onClick={() => useUiStore.getState().setWorkspacePanelOpen(false)}
          className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
          title="Close panel"
        >
          <X size={13} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'files' && <PanelFilesTab />}
        {activeTab === 'search' && <PanelSearchTab />}
        {activeTab === 'activity' && <PanelActivityTab />}
      </div>
    </div>
  );
}

/* ---------- Files tab ---------- */

function PanelFilesTab() {
  const effectiveCwd = useEffectiveCwd();
  const globalCwd = useUiStore((s) => s.cwd);
  const openProjects = useUiStore((s) => s.openProjects);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  // When a workspace is active, show only the workspace worktree.
  // When no workspace is active, show all open projects (like the old sidebar explorer).
  const projects = useMemo(() => {
    if (activeWorkspaceId && effectiveCwd) return [effectiveCwd];
    if (openProjects.length > 0) return openProjects;
    if (globalCwd) return [globalCwd];
    return [];
  }, [activeWorkspaceId, effectiveCwd, openProjects, globalCwd]);

  const hasMultipleProjects = projects.length > 1;

  const handleOpenFolder = async () => {
    const sshConnected = useUiStore.getState().sshConnected;
    if (sshConnected) {
      useUiStore.getState().setOverlay('remote-folder-picker');
      return;
    }
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().addOpenProject(picked);
      useUiStore.getState().setActiveProject(picked);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-text-secondary">
            {projects.length === 0
              ? 'No folder open'
              : hasMultipleProjects
                ? `${projects.length} projects`
                : (projects[0]?.split('/').pop() || 'Project')}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => useUiStore.getState().setOverlay('create-folder')}
            className="premium-toolbar-button rounded-md p-1.5 text-text-tertiary transition-colors hover:text-text-primary"
            title="Create new folder"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={handleOpenFolder}
            className="premium-toolbar-button rounded-md p-1.5 text-text-tertiary transition-colors hover:text-text-primary"
            title="Open folder"
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {projects.length === 0 && (
          <div className="px-2 py-6 text-center">
            <button
              onClick={handleOpenFolder}
              className="premium-toolbar-button inline-flex items-center gap-2 rounded-md border border-border/70 bg-bg-surface/70 px-3 py-2 text-xs text-text-secondary"
            >
              <FolderOpen size={14} />
              Open folder
            </button>
          </div>
        )}
        {projects.map((projectPath) => (
          <ProjectFileTree
            key={projectPath}
            projectPath={projectPath}
            isActive={projectPath === globalCwd}
            showHeader={hasMultipleProjects}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectFileTree({ projectPath, isActive, showHeader }: { projectPath: string; isActive: boolean; showHeader: boolean }) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const projectName = useMemo(() => projectPath.split('/').pop() || projectPath, [projectPath]);

  const loadTree = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const result = await window.api.invoke('fs:readdir', { dirPath: projectPath, depth: 2 }) as TreeNode[];
      setTree(result);
    } catch {
      setTree([]);
    }
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleFileSelect = (filePath: string) => {
    const name = filePath.split('/').pop() || filePath;
    useUiStore.getState().setExplorerOpen(true);
    useUiStore.getState().setActiveFile({ path: filePath, name });
  };

  const handleFileMention = (filePath: string) => {
    useUiStore.getState().setPendingMention({
      path: filePath,
      name: filePath.split('/').pop() || filePath,
    });
  };

  return (
    <div>
      {showHeader && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          onDoubleClick={() => useUiStore.getState().setActiveProject(projectPath)}
          className={`flex w-full items-center gap-1.5 px-1 py-1.5 text-left transition-colors hover:bg-bg-hover ${
            isActive ? 'text-accent' : 'text-text-secondary'
          }`}
          title={`${projectPath}\nDouble-click to set as active`}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <FolderOpen size={12} className="shrink-0 opacity-60" />
          <span className="truncate text-[12px] font-semibold">{projectName}</span>
        </button>
      )}
      {!collapsed && (
        <>
          {loading && tree.length === 0 && (
            <p className="px-4 py-2 text-[11px] text-text-tertiary">Loading...</p>
          )}
          {!loading && tree.length === 0 && (
            <p className="px-4 py-2 text-[11px] text-text-tertiary">Empty directory</p>
          )}
          <FileTree nodes={tree} onFileSelect={handleFileSelect} onFileDoubleClick={handleFileMention} />
        </>
      )}
    </div>
  );
}

/* ---------- Search tab ---------- */

function PanelSearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ file: string; line: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const effectiveCwd = useEffectiveCwd();

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !effectiveCwd) return;
    setSearching(true);
    try {
      const res = await window.api.invoke('fs:grep', { pattern: query, cwd: effectiveCwd }) as { file: string; line: number; text: string }[];
      setResults(res ?? []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, [query, effectiveCwd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/70 px-3.5 py-3">
        <div className="classic-section-label pb-1.5">Search</div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Search in files"
          autoFocus
          className="premium-focus w-full rounded-lg border border-border/80 bg-bg-surface px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary outline-none transition-colors focus:border-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {searching && <p className="px-3 py-4 text-center text-[12px] text-text-tertiary">Searching...</p>}
        {!searching && results.length === 0 && query && (
          <p className="px-3 py-4 text-center text-[12px] text-text-tertiary">No results</p>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.file}:${r.line}:${i}`}
            onClick={() => {
              const name = r.file.split('/').pop() || r.file;
              useUiStore.getState().setExplorerOpen(true);
              useUiStore.getState().setActiveFile({ path: r.file, name });
            }}
            className="classic-list-button"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-text-primary">{r.file.split('/').pop()}<span className="text-text-tertiary">:{r.line}</span></div>
              <div className="truncate font-mono text-[12px] text-text-tertiary">{r.text}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Activity tab (wraps FileActivityPanel) ---------- */

function PanelActivityTab() {
  const task = useChatStore((s) => s.getActiveTask());
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const contextKey = activeWorkspaceId ?? task?.workspaceId ?? task?.id ?? '';

  // Ensure the file-activity context is "open" while this tab is shown
  useEffect(() => {
    if (contextKey) {
      useUiStore.getState().setFileActivityPanelOpen(true, contextKey);
    }
  }, [contextKey]);

  return <FileActivityPanel embedded />;
}
