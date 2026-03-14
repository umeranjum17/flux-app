import { useState, useCallback, useEffect } from 'react';
import { MessageSquare, Search, Gauge, Files, Terminal, FolderOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiStore } from '../../stores/ui';
import { UsagePanel } from './UsagePanel';
import { WorkspaceTab } from './WorkspaceTab';
import { FileTree, type TreeNode } from '../explorer/FileTree';

type SidebarTab = 'workspaces' | 'search' | 'usage' | 'explorer';

const NAV_ITEMS: { id: SidebarTab; icon: typeof MessageSquare; label: string }[] = [
  { id: 'workspaces', icon: MessageSquare, label: 'Workspaces' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'usage', icon: Gauge, label: 'Usage' },
  { id: 'explorer', icon: Files, label: 'Explorer' },
];

export function Sidebar() {
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const terminalOpen = useUiStore((s) => s.bottomPanelOpen);

  const width = sidebarTab === 'explorer' ? 292 : 240;

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="chrome-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-border/70"
    >
      <div className="flex items-center gap-0.5 border-b border-border/70 px-2 py-1">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <NavIcon
            key={id}
            icon={<Icon size={16} strokeWidth={1.8} />}
            label={label}
            active={sidebarTab === id}
            onClick={() => setSidebarTab(id)}
          />
        ))}

        <div className="mx-1 h-3.5 w-px bg-border/60" />

        <NavIcon
          icon={<Terminal size={16} strokeWidth={1.8} />}
          label="Terminal"
          active={terminalOpen}
          onClick={() => useUiStore.getState().toggleBottomPanel()}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidebarTab === 'workspaces' && <WorkspaceTab />}
        {sidebarTab === 'search' && <SearchTab />}
        {sidebarTab === 'usage' && <UsagePanel />}
        {sidebarTab === 'explorer' && <ExplorerPanel />}
      </div>
    </motion.aside>
  );
}

function NavIcon({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`sidebar-nav-icon ${active ? 'sidebar-nav-icon-active' : ''}`}
    >
      {icon}
    </button>
  );
}

function ExplorerPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FilesTab />
    </div>
  );
}

function FilesTab() {
  const cwd = useUiStore((s) => s.cwd);
  const projectName = useUiStore((s) => s.projectName);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTree = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const result = await window.api.invoke('fs:readdir', { dirPath: cwd, depth: 2 }) as TreeNode[];
      setTree(result);
    } catch {
      setTree([]);
    }
    setLoading(false);
  }, [cwd]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleOpenFolder = async () => {
    const sshConnected = useUiStore.getState().sshConnected;
    if (sshConnected) {
      useUiStore.getState().setOverlay('remote-folder-picker');
      return;
    }
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().setCwd(picked);
    }
  };

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-text-secondary">
            {projectName || 'No folder open'}
          </p>
        </div>
        <button
          onClick={handleOpenFolder}
          className="premium-toolbar-button rounded-md p-1.5 text-text-tertiary transition-colors hover:text-text-primary"
          title="Open folder"
        >
          <FolderOpen size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!cwd && (
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
        {cwd && tree.length === 0 && !loading && (
          <p className="px-4 py-4 text-center text-[11px] text-text-tertiary">Empty directory</p>
        )}
        {loading && tree.length === 0 && (
          <p className="px-4 py-4 text-center text-[11px] text-text-tertiary">Loading...</p>
        )}
        <FileTree nodes={tree} onFileSelect={handleFileSelect} onFileDoubleClick={handleFileMention} />
      </div>
    </div>
  );
}

function SearchTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ file: string; line: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const cwd = useUiStore((s) => s.cwd);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !cwd) return;
    setSearching(true);
    try {
      const res = await window.api.invoke('fs:grep', { pattern: query, cwd }) as { file: string; line: number; text: string }[];
      setResults(res ?? []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, [query, cwd]);

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
