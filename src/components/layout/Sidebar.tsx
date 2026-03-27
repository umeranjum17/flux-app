import { MessageSquare, Gauge, Terminal, EyeOff, LayoutGrid, Code } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiStore } from '../../stores/ui';
import { UsagePanel } from './UsagePanel';
import { WorkspaceTab } from './WorkspaceTab';
import { ChatsPanel } from './ChatsPanel';

type SidebarTab = 'workspaces' | 'usage' | 'chats';

const NAV_ITEMS: { id: SidebarTab; icon: typeof MessageSquare; label: string }[] = [
  { id: 'workspaces', icon: MessageSquare, label: 'Workspaces' },
  { id: 'chats', icon: EyeOff, label: 'Incognito' },
  { id: 'usage', icon: Gauge, label: 'Usage' },
];

export function Sidebar() {
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const terminalOpen = useUiStore((s) => s.bottomPanelOpen);
  const viewMode = useUiStore((s) => s.viewMode);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 280, opacity: 1 }}
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
          onClick={() => useUiStore.getState().toggleTerminal()}
        />

        <div className="mx-1 h-3.5 w-px bg-border/60" />

        <ViewModeToggle viewMode={viewMode} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidebarTab === 'workspaces' && <WorkspaceTab />}
        {sidebarTab === 'chats' && <ChatsPanel />}
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

function ViewModeToggle({ viewMode }: { viewMode: 'eng' | 'product' }) {
  return (
    <div className="flex items-center rounded-md border border-border/60 bg-bg-primary/50">
      <button
        title="Engineering Mode"
        onClick={() => useUiStore.getState().setViewMode('eng')}
        className={`inline-flex items-center justify-center rounded-l-md px-1.5 py-1 transition-colors ${
          viewMode === 'eng'
            ? 'bg-bg-hover text-text-primary'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        <Code size={13} strokeWidth={2} />
      </button>
      <button
        title="Product Mode (Kanban)"
        onClick={() => useUiStore.getState().setViewMode('product')}
        className={`inline-flex items-center justify-center rounded-r-md px-1.5 py-1 transition-colors ${
          viewMode === 'product'
            ? 'bg-bg-hover text-text-primary'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        <LayoutGrid size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
