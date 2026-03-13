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
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const projectName = useUiStore((s) => s.projectName);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);
  const environment = useUiStore((s) => s.environment);

  const titleText = projectName || 'Flux';
  const activeWorkspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
  const subtitle = reviewingWorkspaceId
    ? 'Review changes'
    : dashboardOpen
      ? activeWorkspace?.branch ?? 'Workspace dashboard'
      : sshConnected && sshHost
        ? `SSH · ${sshHost}`
        : environment === 'wsl'
          ? 'Local · WSL'
          : 'Local workspace';

  return (
    <div
      className={`drag-region flex h-[40px] min-h-[40px] items-center justify-between border-b border-border bg-bg-secondary px-3 ${isMac ? 'pl-[72px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      <div className="no-drag flex min-w-0 items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <div className="h-4 w-px bg-border-subtle" />
        <div className="min-w-0 select-none">
          <div className="truncate text-[12px] font-semibold text-text-primary">{titleText}</div>
          <div className="truncate text-[10px] text-text-tertiary">{subtitle}</div>
        </div>
        {environment === 'wsl' && (
          <span className="premium-pill select-none rounded-md px-1.5 py-0.5 text-[10px] font-medium text-warning">
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span className="premium-pill select-none rounded-md px-1.5 py-0.5 text-[10px] font-medium text-info">
            SSH Session
          </span>
        )}
        {sshConnected && sshHost && (
          <span className="premium-pill select-none rounded-md border border-accent/20 bg-accent-muted/35 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            SSH
          </span>
        )}
      </div>

      <div className="no-drag flex min-w-0 items-center gap-1.5 overflow-hidden">
        <button
          onClick={toggleAutoApprove}
          className={`premium-toolbar-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
            autoApprove
              ? 'border-success/25 bg-success/12 text-success'
              : 'text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
          Auto
        </button>

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`premium-toolbar-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
            dashboardOpen
              ? 'border-accent/20 bg-accent-muted/40 text-accent'
              : 'text-text-secondary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
          Workspaces
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
