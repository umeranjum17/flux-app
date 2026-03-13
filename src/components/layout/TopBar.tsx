import { Menu, Settings, LayoutGrid, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';

const isMac = window.api?.platform === 'darwin';
const isWin = window.api?.platform === 'win32';

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
  const environment = useUiStore((s) => s.environment);

  const titleText = projectName || 'Flux';

  return (
    <div
      className={`drag-region flex items-center justify-between h-[38px] min-h-[38px] border-b border-border-subtle/80 bg-bg-secondary/70 px-3 backdrop-blur-xl ${isMac ? 'pl-[72px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      {/* Left: hamburger + title */}
      <div className="no-drag flex items-center gap-2.5">
        <button
          onClick={toggleSidebar}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <span className="select-none text-[13px] font-semibold tracking-[0.01em] text-text-primary">
          {titleText}
        </span>
        {environment === 'wsl' && (
          <span className="premium-pill select-none rounded-full px-2 py-0.5 text-[10px] font-medium text-warning">
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span className="premium-pill select-none rounded-full px-2 py-0.5 text-[10px] font-medium text-info">
            SSH Session
          </span>
        )}
        {sshConnected && sshHost && (
          <span className="premium-pill select-none rounded-full border border-accent/25 bg-accent-muted/40 px-2 py-0.5 text-[10px] font-medium text-accent">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1 min-w-0 overflow-hidden">
        {/* Auto-approve toggle */}
        <button
          onClick={toggleAutoApprove}
          className={`premium-toolbar-button rounded-lg p-1.5 ${
            autoApprove
              ? 'border-success/25 bg-success/12 text-success'
              : 'text-text-tertiary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
        </button>

        <div className="w-px h-4 bg-border-subtle mx-0.5" />

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`premium-toolbar-button rounded-lg p-1.5 ${
            dashboardOpen
              ? 'border-accent/25 bg-accent-muted/50 text-accent'
              : 'text-text-tertiary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
