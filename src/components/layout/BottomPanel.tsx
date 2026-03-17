import { forwardRef, useState, useCallback, useRef } from 'react';
import {
  Maximize2, Minimize2,
  PanelBottomClose,
} from 'lucide-react';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';
import { RunPanel } from '../terminal/RunPanel';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';

export const BottomPanel = forwardRef<TerminalPanelHandle>(function BottomPanel(_props, ref) {
  const [height, setHeight] = useState(260);
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const prevHeight = useRef(260);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);

  const toggleBottomPanel = useUiStore((s) => s.toggleBottomPanel);
  const hasWorkspace = useWorkspaceStore((s) => !!s.activeWorkspaceId);

  // Drag to resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const newHeight = Math.max(120, Math.min(600, dragRef.current.startH + delta));
      setHeight(newHeight);
      if (maximized) setMaximized(false);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height, maximized]);

  const toggleMaximize = useCallback(() => {
    if (maximized) {
      setHeight(prevHeight.current);
      setMaximized(false);
    } else {
      prevHeight.current = height;
      setHeight(window.innerHeight * 0.7);
      setMaximized(true);
    }
  }, [maximized, height]);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-bg-secondary"
      style={{ height: maximized ? '70vh' : height, minHeight: 120 }}
    >
      {/* Resize handle */}
      <div
        className="group flex h-[3px] cursor-row-resize items-center justify-center transition-colors hover:bg-accent/30"
        onMouseDown={handleMouseDown}
      >
        <div className="h-[1px] w-8 rounded bg-text-tertiary/20 group-hover:bg-accent/60 transition-colors" />
      </div>

      {/* Panel header */}
      <div className="flex items-center h-[30px] px-2 bg-bg-secondary select-none shrink-0">
        <div className="flex items-center gap-0.5 flex-1">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-primary px-2.5 py-1">
            TERMINAL
          </span>
        </div>

        {/* Panel actions */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={toggleMaximize}
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={maximized ? 'Restore Panel Size' : 'Maximize Panel'}
            aria-label={maximized ? 'Restore Panel Size' : 'Maximize Panel'}
          >
            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={toggleBottomPanel}
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Close Panel (Ctrl+`)"
            aria-label="Close Panel"
          >
            <PanelBottomClose size={12} />
          </button>
        </div>
      </div>

      {/* Run toolbar (shown when workspace is active) */}
      {hasWorkspace && <RunPanel terminalRef={terminalRef} />}

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        <TerminalPanel ref={(handle) => {
          terminalRef.current = handle;
          if (typeof ref === 'function') ref(handle);
          else if (ref) ref.current = handle;
        }} />
      </div>
    </div>
  );
});
