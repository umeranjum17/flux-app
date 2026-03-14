import { Menu, Settings, LayoutGrid, ShieldCheck, ShieldOff, GitBranch, ChevronRight, ChevronDown, FolderOpen } from 'lucide-react';
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
  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitUpstream = useUiStore((s) => s.gitUpstream);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const cwd = useUiStore((s) => s.cwd);

  const workspaceName = cwd ? '/' + (cwd.split('/').pop() || '') : '';

  return (
    <div
      className={`drag-region chrome-topbar flex min-h-[40px] flex-col border-b border-border/80 ${isMac ? 'pl-[78px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      {/* Top row: toolbar icons */}
      <div className="flex h-[40px] items-center justify-between px-4">
        <div className="no-drag flex min-w-0 items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="premium-toolbar-button rounded-lg p-2 text-text-secondary"
            aria-label="Toggle sidebar"
          >
            <Menu size={15} />
          </button>
        </div>

        <div className="no-drag flex min-w-0 items-center gap-2 overflow-hidden">
          <button
            onClick={toggleAutoApprove}
            className={`premium-toolbar-button rounded-lg p-2 ${
              autoApprove
                ? 'text-success'
                : 'text-text-secondary'
            }`}
            aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
            title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
          >
            {autoApprove ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
          </button>

          <button
            onClick={() => setDashboardOpen(!dashboardOpen)}
            className={`premium-toolbar-button rounded-lg p-2 ${
              dashboardOpen
                ? 'text-accent'
                : 'text-text-secondary'
            }`}
            aria-label="Toggle workspaces"
            title="Workspaces"
          >
            <LayoutGrid size={14} />
          </button>

          <button
            onClick={() => setOverlay('settings')}
            className="premium-toolbar-button rounded-lg p-2 text-text-secondary"
            aria-label="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Branch info bar */}
      {gitBranch && (
        <div className="no-drag flex h-[32px] items-center gap-0 border-t border-border/50 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch size={14} className="shrink-0 text-text-tertiary" />
            <span className="truncate text-[12px] font-medium text-text-primary">
              {gitBranch}
            </span>
            {gitDirty && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Uncommitted changes" />
            )}
            {gitUpstream && (
              <>
                <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
                <span className="flex items-center gap-1 truncate text-[12px] text-text-secondary">
                  {gitUpstream}
                  <ChevronDown size={10} className="shrink-0 text-text-tertiary" />
                </span>
              </>
            )}
          </div>

          <div className="flex-1" />

          {workspaceName && (
            <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-bg-secondary px-2.5 py-1">
              <FolderOpen size={12} className="shrink-0 text-accent" />
              <span className="text-[11px] font-medium text-text-primary">{workspaceName}</span>
              <span className="text-[11px] text-text-secondary">Open</span>
              <ChevronDown size={10} className="text-text-tertiary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
