import { useEffect, useState } from 'react';
import { Menu, Settings, ShieldCheck, ShieldOff, Kanban, List } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

const isMac = window.api?.platform === 'darwin';
const isWin = window.api?.platform === 'win32';

interface FullscreenChangedPayload {
  isFullscreen: boolean;
}

function isFullscreenChangedPayload(value: unknown): value is FullscreenChangedPayload {
  return typeof value === 'object'
    && value !== null
    && 'isFullscreen' in value
    && typeof (value as { isFullscreen?: unknown }).isFullscreen === 'boolean';
}

export function TopBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const autoApprove = useUiStore((s) => s.autoApprove);
  const toggleAutoApprove = useUiStore((s) => s.toggleAutoApprove);
  const workspaceViewMode = useUiStore((s) => s.workspaceViewMode);
  const toggleWorkspaceViewMode = useUiStore((s) => s.toggleWorkspaceViewMode);

  useEffect(() => {
    if (!isMac) return;

    let disposed = false;
    const unsubscribe = window.api.on('window:fullscreen-changed', (payload: unknown) => {
      if (isFullscreenChangedPayload(payload)) {
        setIsFullscreen(payload.isFullscreen);
      }
    });

    window.api.invoke('window:is-fullscreen')
      .then((value) => {
        if (!disposed && typeof value === 'boolean') {
          setIsFullscreen(value);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return (
    <div
      className={`drag-region chrome-topbar flex h-[34px] min-h-[34px] items-center justify-between border-b border-border/80 px-3.5 ${isMac && !isFullscreen ? 'pl-[74px]' : ''} ${isWin ? 'pr-[136px]' : ''}`}
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
          onClick={toggleWorkspaceViewMode}
          className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
          aria-label={workspaceViewMode === 'kanban' ? 'Switch to list view' : 'Switch to kanban view'}
          title={workspaceViewMode === 'kanban' ? 'Switch to list view' : 'Switch to kanban view'}
        >
          {workspaceViewMode === 'kanban' ? <List size={13} /> : <Kanban size={13} />}
        </button>

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
