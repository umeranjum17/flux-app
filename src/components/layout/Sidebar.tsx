import { useState, useMemo, useEffect, useCallback } from 'react';
import { MessageSquare, Files, Search, GitBranch, Plus, FolderOpen, Wifi, X, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { FileTree, type TreeNode } from '../explorer/FileTree';
import { restoreSessionMessage } from '../../lib/session-messages';
import type { TaskStatus } from '../../lib/types';
import type { SessionMessage } from '../../lib/ipc-api';
import { UsagePanel } from './UsagePanel';

type SidebarTab = 'chat' | 'files' | 'search' | 'usage' | 'git';

const statusColors: Record<TaskStatus, string> = {
  running: 'bg-success',
  waiting_approval: 'bg-warning',
  idle: 'bg-text-tertiary',
  error: 'bg-error',
  done: 'bg-info',
};

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 260, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="flex flex-col h-full shrink-0 bg-bg-secondary border-r border-border overflow-hidden"
    >
      {/* Horizontal icon tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-border">
        <TabButton icon={<MessageSquare size={15} />} label="Chat" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        <TabButton icon={<Files size={15} />} label="Files" active={activeTab === 'files'} onClick={() => setActiveTab('files')} />
        <TabButton icon={<Search size={15} />} label="Search" active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
        <TabButton icon={<BarChart3 size={15} />} label="Usage" active={activeTab === 'usage'} onClick={() => setActiveTab('usage')} />
        <TabButton icon={<GitBranch size={15} />} label="Git" active={activeTab === 'git'} onClick={() => setActiveTab('git')} />

        <div className="flex-1" />
        <button
          onClick={() => useUiStore.getState().toggleSidebar()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'files' && <FilesTab />}
        {activeTab === 'search' && <SearchTab />}
        {activeTab === 'usage' && <UsagePanel />}
        {activeTab === 'git' && <GitTab />}
      </div>
    </motion.aside>
  );
}

function TabButton({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-bg-hover text-text-primary'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
      }`}
    >
      {icon}
    </button>
  );
}

/* ── Chat Tab ─────────────────────────────── */

function ChatTab() {
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const setActiveTask = useChatStore((s) => s.setActiveTask);
  const sessions = useSessionStore((s) => s.sessions);
  const projectName = useUiStore((s) => s.projectName);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);

  const handleLoadSession = useCallback(async (session: { id: string; title: string; agentId: string; model: string; mode: string; cwd: string }) => {
    const taskId = crypto.randomUUID();
    useChatStore.getState().createTask({
      id: taskId,
      title: session.title || 'Untitled',
      agentId: session.agentId as import('../../lib/types').AgentId,
      model: session.model,
      mode: (session.mode as import('../../lib/types').TaskMode) || 'act',
      thinking: 'medium',
      cwd: session.cwd || useUiStore.getState().cwd || '.',
    });
    useChatStore.getState().setTaskSessionId(taskId, session.id);
    useChatStore.getState().setActiveTask(taskId);

    // Load session messages into the task
    try {
      const messages = await window.api.invoke('sessions:messages', { id: session.id }) as SessionMessage[];
      for (const msg of messages) {
        const restored = restoreSessionMessage(msg);
        if (restored) {
          useChatStore.getState().addMessage(taskId, restored);
        }
      }
    } catch {
      // Failed to load session messages
    }

    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const taskList = useMemo(() => Array.from(tasks.values()), [tasks]);
  const totalCost = useMemo(() => taskList.reduce((sum, t) => sum + t.costUsd, 0), [taskList]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {projectName && (
        <div className="px-3 pt-2 pb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-primary truncate">{projectName}</span>
            {sshConnected && sshHost && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">SSH</span>
            )}
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Active</span>
        <button
          onClick={() => {
            useChatStore.getState().setActiveTask(null);
            useUiStore.getState().setBottomPanelMode('agent');
          }}
          className="p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5">
        {taskList.length === 0 && (
          <div className="px-2 py-4 text-center">
            <p className="text-[11px] text-text-tertiary">No active tasks</p>
            <p className="text-[10px] text-text-tertiary mt-1">Start a conversation to create one</p>
          </div>
        )}
        {taskList.map((task) => (
          <button
            key={task.id}
            onClick={() => setActiveTask(task.id)}
            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
              task.id === activeTaskId
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${statusColors[task.status]}`} />
            <span className="truncate">{task.title || 'Untitled'}</span>
          </button>
        ))}
      </div>

      <div className="mx-3 border-t border-border" />
      <div className="px-3 pt-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Sessions</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5 min-h-0">
        {sessions.length === 0 && (
          <p className="text-[11px] text-text-tertiary px-2 py-3">No saved sessions</p>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => handleLoadSession(session)}
            className="w-full flex items-center rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <span className="truncate">{session.title || 'Untitled'}</span>
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border">
        <span className="text-[11px] text-text-tertiary">Total cost: ${totalCost.toFixed(4)}</span>
      </div>
    </div>
  );
}

/* ── Files Tab ────────────────────────────── */

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
      useUiStore.getState().setExplorerOpen(true);
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

/* ── Search Tab ───────────────────────────── */

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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 pt-2 pb-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Search in files..."
          autoFocus
          className="w-full px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        {searching && <p className="text-[11px] text-text-tertiary px-2 py-3 text-center">Searching...</p>}
        {!searching && results.length === 0 && query && (
          <p className="text-[11px] text-text-tertiary px-2 py-3 text-center">No results</p>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.file}:${r.line}:${i}`}
            onClick={() => {
              const name = r.file.split('/').pop() || r.file;
              useUiStore.getState().setExplorerOpen(true);
              useUiStore.getState().setActiveFile({ path: r.file, name });
            }}
            className="w-full text-left px-2 py-1 rounded-md hover:bg-bg-hover transition-colors"
          >
            <div className="text-[11px] text-accent truncate">{r.file.split('/').pop()}<span className="text-text-tertiary">:{r.line}</span></div>
            <div className="text-[10px] text-text-tertiary truncate font-mono">{r.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Git Tab ──────────────────────────────── */

function GitTab() {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);

  return (
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-2">
      <div className="space-y-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Branch</span>
          <div className="flex items-center gap-2 mt-1.5">
            <GitBranch size={14} className="text-text-tertiary" />
            <span className="text-xs text-text-primary font-medium">{gitBranch || 'Not a git repo'}</span>
            {gitDirty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium">modified</span>
            )}
          </div>
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Environment</span>
          <div className="flex items-center gap-2 mt-1.5">
            {sshConnected ? (
              <>
                <Wifi size={14} className="text-accent" />
                <span className="text-xs text-accent font-medium">{sshHost}</span>
              </>
            ) : (
              <span className="text-xs text-text-secondary">Local</span>
            )}
          </div>
        </div>

        <button
          onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
          className="w-full py-2 rounded-lg bg-bg-primary border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {sshConnected ? 'Manage SSH' : 'Connect SSH'}
        </button>
      </div>
    </div>
  );
}
