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
      className={`drag-region flex items-center justify-between h-[40px] min-h-[40px] bg-bg-secondary border-b border-border px-3 ${isMac ? 'pl-[72px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      {/* Left: hamburger + title */}
      <div className="no-drag flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <span className="text-[13px] font-semibold text-text-primary select-none tracking-[-0.01em]">
          {titleText}
        </span>
        {environment === 'wsl' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/12 text-blue-400 font-medium select-none leading-none">
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/12 text-purple-400 font-medium select-none leading-none">
            SSH Session
          </span>
        )}
        {sshConnected && sshHost && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/12 text-accent font-medium select-none leading-none">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1.5 min-w-0 overflow-hidden">
        {/* Auto-approve toggle */}
        <button
          onClick={toggleAutoApprove}
          className={`flex items-center gap-1 px-2 py-[5px] rounded-lg text-[11px] font-medium transition-all duration-150 ${
            autoApprove
              ? 'bg-success/12 text-success hover:bg-success/20'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={13} strokeWidth={2} /> : <ShieldOff size={13} strokeWidth={2} />}
          <span className="hidden sm:inline">{autoApprove ? 'Auto' : ''}</span>
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`p-1.5 rounded-lg transition-colors ${
            dashboardOpen
              ? 'bg-accent/12 text-accent'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
