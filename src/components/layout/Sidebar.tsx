import { useState, useCallback, useEffect } from 'react';
import { MessageSquare, Search, Gauge, Files, Terminal, FolderOpen, GitCompareArrows, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
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
      {/* Icon nav */}
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

/* ── Explorer Panel (moved from RightSidebar) ── */

function ExplorerPanel() {
  const activeSubTab = useUiStore((s) => s.explorerSubTab);
  const setSubTab = useUiStore((s) => s.setExplorerSubTab);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-1.5">
        <SubTabButton label="All files" active={activeSubTab === 'files'} onClick={() => setSubTab('files')} />
        <SubTabButton label="Changes" active={activeSubTab === 'changes'} onClick={() => setSubTab('changes')} />
        <SubTabButton label="Checks" active={activeSubTab === 'checks'} onClick={() => setSubTab('checks')} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeSubTab === 'files' && <FilesTab />}
        {activeSubTab === 'changes' && <ChangesTab />}
        {activeSubTab === 'checks' && <ChecksTab />}
      </div>
    </div>
  );
}

function SubTabButton({ label, active, onClick }: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`classic-tab-button px-2.5 py-1 text-[11px] font-medium ${active ? 'classic-tab-button-active' : ''}`}
    >
      {label}
    </button>
  );
}

/* ── Files Tab ── */

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
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="classic-section-label truncate">
          {projectName || 'No folder open'}
        </span>
        <button onClick={handleOpenFolder} className="premium-toolbar-button rounded-md p-1.5 text-text-secondary" title="Open Folder">
          <FolderOpen size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {!cwd && (
          <div className="px-4 py-6 text-center">
            <button onClick={handleOpenFolder} className="premium-toolbar-button inline-flex items-center gap-2 rounded-md border border-border/80 bg-bg-surface px-3 py-2 text-xs text-text-secondary">
              <FolderOpen size={14} />
              Open Folder
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

/* ── Changes Tab ── */

function ChangesTab() {
  const gitDirty = useUiStore((s) => s.gitDirty);
  const gitBranch = useUiStore((s) => s.gitBranch);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <GitCompareArrows size={14} className="text-text-tertiary" />
        <span className="text-[13px] text-text-secondary">{gitBranch || 'No branch'}</span>
        {gitDirty && (
          <span className="rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">modified</span>
        )}
      </div>
      {!gitDirty && (
        <p className="text-[12px] text-text-tertiary text-center py-6">No uncommitted changes</p>
      )}
      {gitDirty && (
        <p className="text-[12px] text-text-tertiary text-center py-6">Working tree has changes</p>
      )}
    </div>
  );
}

/* ── Checks Tab ── */

function ChecksTab() {
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });

  const gateMessages = activeTask?.messages
    .filter((m) => m.type === 'quality_gate' && m.command)
    .reduce((acc, m) => {
      acc.set(m.command!, m);
      return acc;
    }, new Map<string, typeof activeTask.messages[number]>());

  const checks = gateMessages ? Array.from(gateMessages.values()) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5 overflow-y-auto">
      {checks.length > 0 ? (
        <div className="space-y-2">
          {checks.map((check, i) => {
            const passed = check.passed;
            const isPreExisting = check.isPreExisting;
            const statusColor = passed
              ? 'text-success'
              : isPreExisting
                ? 'text-warning'
                : 'text-error';
            return (
              <div key={i} className="rounded-lg border border-border/50 bg-bg-surface/50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className={statusColor} />
                  <code className="flex-1 truncate text-[12px] text-text-secondary">{check.command}</code>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-[21px]">
                  <span className={`text-[11px] font-medium ${statusColor}`}>
                    {passed ? 'Passed' : isPreExisting ? 'Pre-existing failure' : 'Failed'}
                  </span>
                  {typeof check.exitCode === 'number' && !passed && (
                    <span className="text-[10px] text-text-tertiary">exit {check.exitCode}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <CheckCircle2 size={20} className="text-text-tertiary/50" />
          <p className="text-[12px] text-text-tertiary">No checks run yet</p>
          <p className="text-[11px] text-text-tertiary/70">
            Configure commands in Settings → Quality Gates
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Search Tab ── */

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
