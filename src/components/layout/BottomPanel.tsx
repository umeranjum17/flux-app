import { useState, useCallback, useRef, useEffect } from 'react';
import { Maximize2, Minimize2, PanelBottomClose } from 'lucide-react';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { useUiStore } from '../../stores/ui';
import { useTerminalStore } from '../../stores/terminal';

const STORAGE_KEY = 'flux:bottom-panel-height';
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

function loadHeight(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const h = parseInt(stored, 10);
      if (h >= MIN_HEIGHT && h <= MAX_HEIGHT) return h;
    }
  } catch {}
  return 260;
}

function saveHeight(h: number) {
  try { localStorage.setItem(STORAGE_KEY, String(h)); } catch {}
}

export function BottomPanel() {
  const [height, setHeight] = useState(loadHeight);
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const prevHeight = useRef(height);

  const toggleBottomPanel = useUiStore((s) => s.toggleBottomPanel);

  // Persist height changes
  useEffect(() => {
    if (!maximized) saveHeight(height);
  }, [height, maximized]);

  // Drag to resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startH + delta));
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

  // Double-click to toggle maximize
  const handleDoubleClick = useCallback(() => {
    if (maximized) {
      setHeight(prevHeight.current);
      setMaximized(false);
    } else {
      prevHeight.current = height;
      setHeight(window.innerHeight * 0.7);
      setMaximized(true);
    }
  }, [maximized, height]);

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

  // Keyboard resize: Ctrl+Shift+Up/Down
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const step = 40;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHeight((h) => Math.min(MAX_HEIGHT, h + step));
        if (maximized) setMaximized(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHeight((h) => Math.max(MIN_HEIGHT, h - step));
        if (maximized) setMaximized(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [maximized]);

  // Ctrl+F for terminal search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only capture if terminal panel is focused
        const active = document.activeElement;
        if (active?.closest('.xterm')) {
          e.preventDefault();
          useTerminalStore.getState().setSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-bg-secondary"
      style={{ height: maximized ? '70vh' : height, minHeight: MIN_HEIGHT }}
    >
      {/* Resize handle */}
      <div
        className="group flex h-[3px] cursor-row-resize items-center justify-center transition-colors hover:bg-accent/30"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
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

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        <TerminalPanel />
      </div>
    </div>
  );
}
