import { Menu, Settings, LayoutGrid, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';

const isMac = window.api?.platform === 'darwin';

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const autoApprove = useUiStore((s) => s.autoApprove);
  const toggleAutoApprove = useUiStore((s) => s.toggleAutoApprove);
  const dashboardOpen = useWorkspaceStore((s) => s.dashboardOpen);
  const setDashboardOpen = useWorkspaceStore((s) => s.setDashboardOpen);

  const projectName = useUiStore((s) => s.projectName);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);

  const titleText = projectName || 'Flux';

  return (
    <div
      className={`drag-region flex items-center justify-between h-[38px] min-h-[38px] bg-bg-secondary border-b border-border-subtle px-3 ${isMac ? 'pl-[72px]' : ''}`}
    >
      {/* Left: hamburger + title */}
      <div className="no-drag flex items-center gap-2.5">
        <button
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <span className="text-[13px] font-semibold text-text-primary select-none">
          {titleText}
        </span>
        {sshConnected && sshHost && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-accent/15 text-accent font-medium select-none">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1">
        {/* Auto-approve toggle */}
        <button
          onClick={toggleAutoApprove}
          className={`p-1.5 rounded-md transition-colors ${
            autoApprove
              ? 'bg-success/15 text-success hover:bg-success/25'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
        </button>

        <div className="w-px h-4 bg-border-subtle mx-0.5" />

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`p-1.5 rounded transition-colors ${
            dashboardOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
