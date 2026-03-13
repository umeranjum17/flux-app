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
      animate={{ width: 280, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="flex flex-col h-full shrink-0 bg-bg-secondary border-l border-border-subtle overflow-hidden"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1.5 border-b border-border-subtle">
        <TabButton label="All files" active={activeTab === 'files'} onClick={() => setTab('files')} />
        <TabButton label="Changes 0" active={activeTab === 'changes'} onClick={() => setTab('changes')} />
        <TabButton label="Checks" active={activeTab === 'checks'} onClick={() => setTab('checks')} />
        <div className="flex-1" />
        <button className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors" title="Filter">
          <Filter size={13} />
        </button>
        <button className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors" title="Search">
          <Search size={13} />
        </button>
        <button
          onClick={close}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
        active
          ? 'bg-bg-hover text-text-primary'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/60'
      }`}
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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary truncate">
          {projectName || 'No folder open'}
        </span>
        <button onClick={handleOpenFolder} className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title="Open Folder">
          <FolderOpen size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {!cwd && (
          <div className="px-3 py-6 text-center">
            <button onClick={handleOpenFolder} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              <FolderOpen size={14} />
              Open Folder
            </button>
          </div>
        )}
        {cwd && tree.length === 0 && !loading && (
          <p className="text-[11px] text-text-tertiary px-3 py-4 text-center">Empty directory</p>
        )}
        {loading && tree.length === 0 && (
          <p className="text-[11px] text-text-tertiary px-3 py-4 text-center">Loading...</p>
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
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-3">
      <div className="flex items-center gap-2 mb-3">
        <GitCompareArrows size={14} className="text-text-tertiary" />
        <span className="text-xs text-text-secondary">{gitBranch || 'No branch'}</span>
        {gitDirty && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium">modified</span>
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
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-3">
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
