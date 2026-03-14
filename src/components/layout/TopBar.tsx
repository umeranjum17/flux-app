import { Menu, Settings, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

const isMac = window.api?.platform === 'darwin';
const isWin = window.api?.platform === 'win32';

export function TopBar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const autoApprove = useUiStore((s) => s.autoApprove);
  const toggleAutoApprove = useUiStore((s) => s.toggleAutoApprove);

  return (
    <div
      className={`drag-region chrome-topbar flex h-[34px] min-h-[34px] items-center justify-between border-b border-border/80 px-3.5 ${isMac ? 'pl-[74px]' : ''} ${isWin ? 'pr-[136px]' : ''}`}
    >
      <div className="no-drag flex min-w-0 items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu size={14} />
        </button>
      </div>

      <div className="no-drag flex min-w-0 items-center gap-1.5 overflow-hidden">
        <button
          onClick={toggleAutoApprove}
          className={`premium-toolbar-button rounded-md p-1.5 ${
            autoApprove
              ? 'text-success'
              : 'text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={13} />
        </button>
      </div>
    </div>
  );
}
