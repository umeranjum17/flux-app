import { useState, useMemo, useCallback, type ReactNode } from 'react';
import {
  MessageSquare,
  Search,
  GitBranch,
  Plus,
  Wifi,
  X,
  BarChart3,
  LayoutGrid,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { restoreSessionMessage } from '../../lib/session-messages';
import type { TaskStatus } from '../../lib/types';
import type { SessionMessage } from '../../lib/ipc-api';
import { UsagePanel } from './UsagePanel';

type SidebarTab = 'chat' | 'search' | 'usage' | 'git';

const statusColors: Record<TaskStatus, string> = {
  running: 'bg-success',
  waiting_approval: 'bg-warning',
  waiting_input: 'bg-info',
  idle: 'bg-text-tertiary',
  error: 'bg-error',
  done: 'bg-info',
};

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('chat');
  const setDashboardOpen = useWorkspaceStore((s) => s.setDashboardOpen);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 248, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="chrome-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-white/6"
    >
      <div className="flex items-center justify-between border-b border-white/6 px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-[8px] border border-white/8 bg-white/[0.03] text-[10px] font-semibold tracking-[0.14em] text-text-primary">
            FX
          </div>
          <button
            type="button"
            className="chrome-rail-button h-7 w-7"
            title="Workspace dashboard"
            onClick={() => setDashboardOpen(true)}
          >
            <LayoutGrid size={14} />
          </button>
        </div>
        <button
          onClick={() => useUiStore.getState().toggleSidebar()}
          className="premium-toolbar-button rounded-[8px] border border-white/8 bg-white/[0.02] p-1.5 text-text-secondary"
          aria-label="Close sidebar"
        >
          <X size={13} />
        </button>
      </div>

      <div className="border-b border-white/6 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <SidebarIconButton icon={<MessageSquare size={15} />} label="Conversations" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <SidebarIconButton icon={<Search size={15} />} label="Search" active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
          <SidebarIconButton icon={<BarChart3 size={15} />} label="Usage" active={activeTab === 'usage'} onClick={() => setActiveTab('usage')} />
          <SidebarIconButton icon={<GitBranch size={15} />} label="Repository" active={activeTab === 'git'} onClick={() => setActiveTab('git')} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'search' && <SearchTab />}
        {activeTab === 'usage' && <UsagePanel />}
        {activeTab === 'git' && <GitTab />}
      </div>
    </motion.aside>
  );
}

function SidebarIconButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`chrome-rail-button h-8 w-8 ${active ? 'chrome-rail-button-active' : ''}`}
    >
      {icon}
    </button>
  );
}

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
  const totalCost = useMemo(() => taskList.reduce((sum, task) => sum + task.costUsd, 0), [taskList]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/6 px-4 pt-4 pb-3">
        <div className="classic-section-label">Conversations</div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[18px] font-semibold tracking-[-0.02em] text-text-primary">
              {projectName || 'Flux'}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary">
              {sshConnected ? <Wifi size={11} className="text-accent" /> : null}
              <span>{sshConnected && sshHost ? sshHost : 'Local workspace'}</span>
            </div>
          </div>
          <button
            onClick={() => {
              useChatStore.getState().setActiveTask(null);
              useUiStore.getState().setBottomPanelMode('agent');
            }}
            className="premium-toolbar-button rounded-[8px] border border-white/8 bg-white/[0.02] p-1.5 text-text-secondary"
            aria-label="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {taskList.length === 0 && (
          <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-4 py-5 text-left">
            <p className="text-[13px] font-medium text-text-secondary">No active conversations</p>
            <p className="mt-1 text-[11px] leading-5 text-text-tertiary">Start a conversation to create one.</p>
          </div>
        )}

        {taskList.length > 0 && (
          <div className="space-y-1.5">
            {taskList.map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveTask(task.id)}
                className={`classic-list-button ${task.id === activeTaskId ? 'classic-list-button-active' : ''}`}
              >
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColors[task.status]}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text-primary">{task.title || 'Untitled'}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                    {task.status.replace('_', ' ')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-white/6 pt-4">
          <div className="mb-2 px-1 text-[11px] font-medium text-text-secondary">Sessions</div>
          <div className="space-y-1.5">
            {sessions.length === 0 && (
              <div className="rounded-[10px] border border-white/6 bg-white/[0.02] px-3 py-3 text-[11px] text-text-tertiary">
                No saved sessions
              </div>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleLoadSession(session)}
                className="classic-list-button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-text-primary">{session.title || 'Untitled'}</div>
                  <div className="mt-1 text-[10px] text-text-tertiary">{session.agentId} · {session.model}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/6 px-4 py-3 text-[11px] text-text-tertiary">
        Total cost ${totalCost.toFixed(4)}
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
    if (!query.trim() || !cwd) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await window.api.invoke('fs:grep', { pattern: query, cwd }) as { file: string; line: number; text: string }[];
      setResults(res ?? []);
    } catch {
      setResults([]);
    }
    setSearching(false);
  }, [cwd, query]);

  const showEmptyState = !query.trim() && !searching && results.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/6 px-4 pt-4 pb-4">
        <div className="text-[13px] font-medium text-text-secondary">Search</div>
        <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-white/10 bg-black/55 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder="Search in files"
            autoFocus
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text-primary placeholder:text-text-tertiary outline-none"
          />
          <span className="rounded-[6px] border border-white/8 bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-text-tertiary">
            Aa
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5">
        {searching && <p className="text-center text-[11px] text-text-tertiary">Searching...</p>}

        {!searching && showEmptyState && (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full border border-white/8 bg-white/[0.02] text-text-secondary">
              <Search size={28} />
            </div>
            <p className="mt-5 text-[14px] font-semibold text-text-secondary">Global search</p>
            <p className="mt-2 max-w-[180px] text-[12px] leading-5 text-text-tertiary">
              Search in files across your current directories.
            </p>
          </div>
        )}

        {!searching && !showEmptyState && results.length === 0 && (
          <p className="text-center text-[11px] text-text-tertiary">No results</p>
        )}

        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((result, index) => (
              <button
                key={`${result.file}:${result.line}:${index}`}
                onClick={() => {
                  const name = result.file.split('/').pop() || result.file;
                  useUiStore.getState().setExplorerOpen(true);
                  useUiStore.getState().setActiveFile({ path: result.file, name });
                }}
                className="classic-list-button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px] text-text-primary">
                    {result.file.split('/').pop()}
                    <span className="text-text-tertiary">:{result.line}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-text-tertiary">{result.text}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GitTab() {
  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);
  const cwd = useUiStore((s) => s.cwd);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
      <div className="text-[13px] font-medium text-text-secondary">Repository</div>

      <div className="mt-4 space-y-3">
        <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Branch</div>
          <div className="mt-2 flex items-center gap-2">
            <GitBranch size={14} className="text-text-tertiary" />
            <span className="truncate text-[12px] font-medium text-text-primary">{gitBranch || 'Not a git repo'}</span>
            {gitDirty && (
              <span className="rounded-full border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-warning">
                Dirty
              </span>
            )}
          </div>
        </div>

        <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Workspace</div>
          <div className="mt-2 truncate font-mono text-[11px] text-text-secondary">{cwd || 'No folder open'}</div>
        </div>

        <div className="rounded-[12px] border border-white/6 bg-white/[0.02] px-3.5 py-3">
          <div className="text-[10px] uppercase tracking-[0.1em] text-text-tertiary">Environment</div>
          <div className="mt-2 flex items-center gap-2">
            {sshConnected ? <Wifi size={13} className="text-accent" /> : null}
            <span className={`text-[12px] ${sshConnected ? 'text-accent' : 'text-text-secondary'}`}>
              {sshConnected && sshHost ? sshHost : 'Local'}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
          className="premium-toolbar-button w-full rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[12px] text-text-secondary"
        >
          {sshConnected ? 'Manage SSH' : 'Connect SSH'}
        </button>
      </div>
    </div>
  );
}
