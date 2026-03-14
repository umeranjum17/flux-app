import { Menu, Settings, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

const isMac = window.api?.platform === 'darwin';
const isWin = window.api?.platform === 'win32';

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const autoApprove = useUiStore((s) => s.autoApprove);
  const toggleAutoApprove = useUiStore((s) => s.toggleAutoApprove);
  const projectName = useUiStore((s) => s.projectName);

  const titleText = projectName || 'Flux';

  return (
    <div
      className={`drag-region chrome-topbar flex h-[40px] min-h-[40px] items-center justify-between border-b border-border/80 px-4 ${isMac ? 'pl-[78px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      <div className="no-drag flex min-w-0 items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="premium-toolbar-button rounded-lg p-2 text-text-secondary"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <div className="min-w-0 select-none">
          <div className="truncate text-[12px] font-semibold tracking-[0.02em] text-text-primary">{titleText}</div>
        </div>
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
          onClick={() => setOverlay('settings')}
          className="premium-toolbar-button rounded-lg p-2 text-text-secondary"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
