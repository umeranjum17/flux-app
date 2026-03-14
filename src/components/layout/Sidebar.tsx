import { useState, useMemo, useCallback } from 'react';
import { Plus, MessageSquare, Search, Gauge, FolderTree, Terminal } from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import type { TaskStatus } from '../../lib/types';
import { UsagePanel } from './UsagePanel';

const statusColors: Record<TaskStatus, string> = {
  running: 'bg-success',
  waiting_approval: 'bg-warning',
  waiting_input: 'bg-info',
  idle: 'bg-text-tertiary',
  error: 'bg-error',
  done: 'bg-info',
};

type SidebarTab = 'chat' | 'search' | 'usage';

const NAV_ITEMS: { id: SidebarTab; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chats' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'usage', icon: Gauge, label: 'Usage' },
];

export function Sidebar() {
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const terminalOpen = useUiStore((s) => s.bottomPanelOpen);
  const cwd = useUiStore((s) => s.cwd);

  const handleExplorer = () => {
    if (!cwd) {
      window.api.invoke('cwd:pick').then((picked) => {
        if (picked) {
          useUiStore.getState().setCwd(picked as string);
          useUiStore.getState().setExplorerOpen(true);
        }
      });
    } else {
      useUiStore.getState().toggleExplorer();
    }
  };

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 240, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="chrome-sidebar flex h-full shrink-0 flex-col overflow-hidden border-r border-border/70"
    >
      {/* Warp-style icon nav */}
      <div className="flex items-center gap-1 border-b border-border/70 px-2.5 py-2">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <NavIcon
            key={id}
            icon={<Icon size={16} strokeWidth={1.8} />}
            label={label}
            active={sidebarTab === id}
            onClick={() => setSidebarTab(id)}
          />
        ))}

        <div className="mx-1 h-4 w-px bg-border/60" />

        <NavIcon
          icon={<FolderTree size={16} strokeWidth={1.8} />}
          label="Explorer"
          active={explorerOpen}
          onClick={handleExplorer}
        />
        <NavIcon
          icon={<Terminal size={16} strokeWidth={1.8} />}
          label="Terminal"
          active={terminalOpen}
          onClick={() => useUiStore.getState().toggleBottomPanel()}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidebarTab === 'chat' && <ChatTab />}
        {sidebarTab === 'search' && <SearchTab />}
        {sidebarTab === 'usage' && <UsagePanel />}
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

/* ── Chat Tab ─────────────────────────────── */

function ChatTab() {
  const tasks = useChatStore((s) => s.tasks);
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const setActiveTask = useChatStore((s) => s.setActiveTask);

  const taskList = useMemo(() => Array.from(tasks.values()), [tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="classic-section-label">Conversations</span>
        <button
          onClick={() => {
            useChatStore.getState().setActiveTask(null);
            useUiStore.getState().setBottomPanelMode('agent');
          }}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-secondary"
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
          className="premium-focus w-full rounded-lg border border-border/80 bg-bg-surface px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none transition-colors focus:border-accent"
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
