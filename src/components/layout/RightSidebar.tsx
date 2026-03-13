import { useState, useCallback, useEffect } from 'react';
import { Files, GitCompareArrows, CheckCircle2, Filter, Search, X, FolderOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { FileTree, type TreeNode } from '../explorer/FileTree';

type RightSidebarTab = 'files' | 'changes' | 'checks';

export function RightSidebar() {
  const activeTab = useUiStore((s) => s.rightSidebarTab);
  const setTab = useUiStore((s) => s.setRightSidebarTab);
  const close = useUiStore((s) => s.toggleRightSidebar);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 292, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="chrome-sidebar ml-2 flex h-full shrink-0 flex-col overflow-hidden rounded-[24px] border border-border/70"
    >
      <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-3">
        <TabButton label="All files" active={activeTab === 'files'} onClick={() => setTab('files')} />
        <TabButton label="Changes" active={activeTab === 'changes'} onClick={() => setTab('changes')} />
        <TabButton label="Checks" active={activeTab === 'checks'} onClick={() => setTab('checks')} />
        <div className="flex-1" />
        <button className="premium-toolbar-button rounded-xl p-1.5 text-text-secondary" title="Filter">
          <Filter size={13} />
        </button>
        <button className="premium-toolbar-button rounded-xl p-1.5 text-text-secondary" title="Search">
          <Search size={13} />
        </button>
        <button
          onClick={close}
          className="premium-toolbar-button rounded-xl p-1.5 text-text-secondary"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'changes' && <ChangesTab />}
        {activeTab === 'checks' && <ChecksTab />}
      </div>
    </motion.aside>
  );
}

function TabButton({ label, active, onClick }: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`classic-tab-button px-3 py-1.5 text-[11px] font-medium ${active ? 'classic-tab-button-active' : ''}`}
    >
      {label}
    </button>
  );
}

/* -- Files Tab -- */

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
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
        <span className="classic-section-label truncate">
          {projectName || 'No folder open'}
        </span>
        <button onClick={handleOpenFolder} className="premium-toolbar-button rounded-xl p-1.5 text-text-secondary" title="Open Folder">
          <FolderOpen size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {!cwd && (
          <div className="px-4 py-6 text-center">
            <button onClick={handleOpenFolder} className="premium-toolbar-button inline-flex items-center gap-2 rounded-2xl border border-border/80 bg-bg-surface px-3.5 py-2.5 text-xs text-text-secondary">
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

/* -- Changes Tab -- */

function ChangesTab() {
  const gitDirty = useUiStore((s) => s.gitDirty);
  const gitBranch = useUiStore((s) => s.gitBranch);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <GitCompareArrows size={14} className="text-text-tertiary" />
        <span className="text-xs text-text-secondary">{gitBranch || 'No branch'}</span>
        {gitDirty && (
          <span className="rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">modified</span>
        )}
      </div>
      {!gitDirty && (
        <p className="text-[11px] text-text-tertiary text-center py-6">No uncommitted changes</p>
      )}
      {gitDirty && (
        <p className="text-[11px] text-text-tertiary text-center py-6">Working tree has changes</p>
      )}
    </div>
  );
}

/* -- Checks Tab -- */

function ChecksTab() {
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });
  const qualityGate = activeTask?.lastQualityGate;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
      {qualityGate ? (
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className={qualityGate.status === 'passed' ? 'text-success' : 'text-error'} />
          <span className={`text-xs font-medium ${qualityGate.status === 'passed' ? 'text-success' : 'text-error'}`}>
            Checks {qualityGate.status}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-text-tertiary text-center py-6">No checks run yet</p>
      )}
    </div>
  );
}
