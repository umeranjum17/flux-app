import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Files, Search, FilePen, FolderOpen, FolderPlus, ChevronDown, ChevronRight, GitCompareArrows, FilePlus, FileEdit, FileX, FileSymlink, Undo2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { FileTree, type TreeNode } from '../explorer/FileTree';
import { FileActivityPanel } from '../review/FileActivityPanel';
import type { DiffFile } from '../../lib/ipc-api';

type PanelTab = 'files' | 'search' | 'activity' | 'changes';

const PANEL_TABS: { id: PanelTab; icon: typeof Files; label: string }[] = [
  { id: 'files', icon: Files, label: 'Files' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'activity', icon: FilePen, label: 'Activity' },
  { id: 'changes', icon: GitCompareArrows, label: 'Changes' },
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
  const changesPanelOpen = useWorkspaceStore((s) => s.changesPanelOpen);

  if (!open) return null;

  // Only show the changes tab icon when a changes panel is active
  const visibleTabs = changesPanelOpen ? PANEL_TABS : PANEL_TABS.filter((t) => t.id !== 'changes');

  return (
    <div className="w-[280px] shrink-0 border-l border-border/50 bg-bg-surface/30 flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-border/40 px-2 py-1">
        <div className="flex items-center gap-0.5">
          {visibleTabs.map(({ id, icon: Icon, label }) => (
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
        {activeTab === 'changes' && <PanelChangesTab />}
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
  const contextKey = task?.workspaceId ?? task?.id ?? '';

  // Ensure the file-activity context is "open" while this tab is shown
  useEffect(() => {
    if (contextKey) {
      useUiStore.getState().setFileActivityPanelOpen(true, contextKey);
    }
  }, [contextKey]);

  return <FileActivityPanel embedded />;
}

/* ---------- Changes tab (changed files list for diff overlay) ---------- */

const changeStatusIcons: Record<DiffFile['status'], React.ReactNode> = {
  added: <FilePlus size={12} className="text-success shrink-0" />,
  modified: <FileEdit size={12} className="text-warning shrink-0" />,
  deleted: <FileX size={12} className="text-error shrink-0" />,
  renamed: <FileSymlink size={12} className="text-info shrink-0" />,
};

function changeFileName(path: string): string {
  return path.split('/').pop() || path;
}

function changeDirName(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
}

function PanelChangesTab() {
  const files = useWorkspaceStore((s) => s.changesPanelFiles);
  const selectedFile = useWorkspaceStore((s) => s.changesPanelSelectedFile);
  const workspaceId = useWorkspaceStore((s) => s.changesPanelWorkspaceId);
  const changesPanelOpen = useWorkspaceStore((s) => s.changesPanelOpen);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const workspace = workspaceId ? workspaces.get(workspaceId) : null;

  const totalAdded = useMemo(() => files.reduce((s, f) => s + f.additions, 0), [files]);
  const totalDeleted = useMemo(() => files.reduce((s, f) => s + f.deletions, 0), [files]);

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!workspaceId) return;
    await window.api.invoke('workspace:discard-file', { workspaceId, filePath });
    useWorkspaceStore.getState().refreshChangesPanelFiles();
  }, [workspaceId]);

  // Keyboard navigation: up/down arrows to cycle files
  useEffect(() => {
    if (!changesPanelOpen || files.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      e.preventDefault();
      const store = useWorkspaceStore.getState();
      const currentIdx = store.changesPanelFiles.findIndex((f) => f.path === store.changesPanelSelectedFile);
      const len = store.changesPanelFiles.length;
      if (len === 0) return;

      let nextIdx: number;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % len;
      } else {
        nextIdx = currentIdx < 0 ? len - 1 : (currentIdx - 1 + len) % len;
      }
      store.changesPanelSelectFile(store.changesPanelFiles[nextIdx].path);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [changesPanelOpen, files.length]);

  if (!changesPanelOpen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <p className="text-[11px] text-text-tertiary text-center">No changes panel open. Use &ldquo;Review Changes&rdquo; on a workspace to view diffs.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-text-secondary">
            Changes
            {files.length > 0 && (
              <span className="text-[11px] text-text-tertiary ml-1.5">
                {files.length} file{files.length !== 1 ? 's' : ''}
                {totalAdded > 0 && <span className="text-success ml-1">+{totalAdded}</span>}
                {totalDeleted > 0 && <span className="text-error ml-1">-{totalDeleted}</span>}
              </span>
            )}
          </p>
          {workspace && (
            <p className="text-[10px] font-mono text-text-tertiary truncate mt-0.5">{workspace.branch}</p>
          )}
        </div>
        <button
          onClick={() => useWorkspaceStore.getState().closeChangesPanel()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Close changes"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">No changes detected</div>
        ) : (
          files.map((file) => {
            const isSelected = file.path === selectedFile;
            return (
              <button
                key={file.path}
                onClick={() => useWorkspaceStore.getState().changesPanelSelectFile(file.path)}
                className={`group w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                {changeStatusIcons[file.status]}
                <span className="flex-1 min-w-0 truncate text-[11px] font-mono">
                  <span className="text-text-tertiary">{changeDirName(file.path)}</span>
                  {changeFileName(file.path)}
                </span>
                <span className="flex items-center gap-1 shrink-0 text-[10px]">
                  {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDiscard(file.path); }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error hover:bg-error/10 transition-all"
                  title="Discard changes"
                >
                  <Undo2 size={11} />
                </button>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
