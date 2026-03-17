import { MessageSquare, Gauge, Terminal } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiStore } from '../../stores/ui';
import { UsagePanel } from './UsagePanel';
import { WorkspaceTab } from './WorkspaceTab';

type SidebarTab = 'workspaces' | 'usage';

const NAV_ITEMS: { id: SidebarTab; icon: typeof MessageSquare; label: string }[] = [
  { id: 'workspaces', icon: MessageSquare, label: 'Workspaces' },
  { id: 'usage', icon: Gauge, label: 'Usage' },
];

export function Sidebar() {
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const terminalOpen = useUiStore((s) => s.bottomPanelOpen && s.bottomPanelTab === 'terminal');

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
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {sidebarTab === 'workspaces' && <WorkspaceTab />}
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
