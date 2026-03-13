import { useState, useMemo, useEffect, useCallback } from 'react';
import { MessageSquare, Search, GitBranch, Plus, Wifi, X, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
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
  const projectName = useUiStore((s) => s.projectName);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 296, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="chrome-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-border/70"
    >
      <div className="flex items-start justify-between border-b border-border/70 px-4 py-4">
        <div className="min-w-0">
          <div className="classic-section-label">Activity</div>
          <div className="mt-2 truncate text-[15px] font-semibold text-text-primary">{projectName || 'Flux'}</div>
          <div className="mt-1 truncate text-[10px] tracking-[0.14em] uppercase text-text-tertiary">
            {sshConnected && sshHost ? `SSH · ${sshHost}` : 'Local workspace'}
          </div>
        </div>
        <button
          onClick={() => useUiStore.getState().toggleSidebar()}
          className="premium-toolbar-button rounded-xl p-2 text-text-secondary"
        >
          <X size={13} />
        </button>
      </div>

      <div className="border-b border-border/70 px-3 py-3">
        <div className="classic-section-label px-1 pb-2">Views</div>
        <div className="space-y-1.5">
          <TabButton icon={<MessageSquare size={14} />} label="Conversations" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
          <TabButton icon={<Search size={14} />} label="Search" active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
          <TabButton icon={<BarChart3 size={14} />} label="Usage" active={activeTab === 'usage'} onClick={() => setActiveTab('usage')} />
          <TabButton icon={<GitBranch size={14} />} label="Repository" active={activeTab === 'git'} onClick={() => setActiveTab('git')} />
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
      className={`classic-nav-button ${active ? 'classic-nav-button-active' : ''}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate text-[12px] font-medium tracking-[0.01em]">{label}</span>
    </button>
  );
}

/* ── Chat Tab ─────────────────────────────── */

function ChatTab() {
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const setActiveTask = useChatStore((s) => s.setActiveTask);
  const sessions = useSessionStore((s) => s.sessions);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="classic-section-label">Conversations</span>
        <button
          onClick={() => {
            useChatStore.getState().setActiveTask(null);
            useUiStore.getState().setBottomPanelMode('agent');
          }}
          className="premium-toolbar-button rounded-xl p-1.5 text-text-secondary"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3">
        {taskList.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[12px] text-text-secondary">No active conversations</p>
            <p className="mt-1 text-[10px] text-text-tertiary">Start a conversation to create one.</p>
          </div>
        )}
        {taskList.map((task) => (
          <button
            key={task.id}
            onClick={() => setActiveTask(task.id)}
            className={`classic-list-button ${task.id === activeTaskId ? 'classic-list-button-active' : ''}`}
          >
            <span className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColors[task.status]}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-text-primary">{task.title || 'Untitled'}</div>
              <div className="mt-0.5 text-[10px] text-text-tertiary">
                {task.status.replace('_', ' ')}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mx-4 mt-3 border-t border-border/70" />
      <div className="px-4 pt-3 pb-2">
        <span className="classic-section-label">Sessions</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3">
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-text-tertiary">No saved sessions</p>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => handleLoadSession(session)}
            className="classic-list-button"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-text-primary">{session.title || 'Untitled'}</div>
              <div className="mt-0.5 text-[10px] text-text-tertiary">{session.agentId} · {session.model}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-border/70 px-4 py-3">
        <span className="text-[11px] text-text-tertiary">Total cost ${totalCost.toFixed(4)}</span>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="classic-section-label pb-2">Search</div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="Search in files"
          autoFocus
          className="premium-focus w-full rounded-2xl border border-border/80 bg-bg-surface px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none transition-colors focus:border-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {searching && <p className="px-3 py-4 text-center text-[11px] text-text-tertiary">Searching...</p>}
        {!searching && results.length === 0 && query && (
          <p className="px-3 py-4 text-center text-[11px] text-text-tertiary">No results</p>
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
              <div className="truncate text-[11px] text-accent">{r.file.split('/').pop()}<span className="text-text-tertiary">:{r.line}</span></div>
              <div className="truncate font-mono text-[10px] text-text-tertiary">{r.text}</div>
            </div>
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
      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <div className="space-y-4">
          <div>
            <span className="classic-section-label">Branch</span>
          <div className="flex items-center gap-2 mt-1.5">
            <GitBranch size={14} className="text-text-tertiary" />
            <span className="text-xs text-text-primary font-medium">{gitBranch || 'Not a git repo'}</span>
            {gitDirty && (
              <span className="rounded-md border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">modified</span>
            )}
          </div>
        </div>

        <div>
          <span className="classic-section-label">Environment</span>
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
          className="premium-toolbar-button w-full rounded-2xl border border-border/80 bg-bg-surface py-2.5 text-xs text-text-secondary"
        >
          {sshConnected ? 'Manage SSH' : 'Connect SSH'}
        </button>
      </div>
    </div>
  );
}
