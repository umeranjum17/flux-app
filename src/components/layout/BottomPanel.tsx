import { forwardRef, useState, useCallback, useRef, useEffect } from 'react';
import { TerminalSquare, Settings2, Play, Plus, GripHorizontal } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';
import { RunPanel } from '../terminal/RunPanel';

type BottomPanelTab = 'setup' | 'run' | 'terminal';

export const BottomPanel = forwardRef<TerminalPanelHandle>(function BottomPanel(_props, ref) {
  const tab = useUiStore((s) => s.bottomPanelTab);
  const setTab = useUiStore((s) => s.setBottomPanelTab);
  const [height, setHeight] = useState(176);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const switchTab = useCallback((t: BottomPanelTab) => {
    setTab(t);
    if (t === 'terminal' && ref && 'current' in ref) {
      requestAnimationFrame(() => ref.current?.focusActive());
    }
  }, [setTab, ref]);

  // Drag to resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setHeight(Math.max(96, Math.min(420, dragRef.current.startH + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-bg-secondary"
      style={{ height, minHeight: 96 }}
    >
      <div
        className="group flex h-2 cursor-row-resize items-center justify-center transition-colors hover:bg-bg-hover"
        onMouseDown={handleMouseDown}
      >
        <GripHorizontal size={12} className="text-text-tertiary/40 group-hover:text-text-tertiary" />
      </div>

      <div className="flex shrink-0 items-center gap-0 border-b border-border bg-bg-secondary">
        <TabBtn active={tab === 'setup'} onClick={() => switchTab('setup')}>
          <Settings2 size={12} />
          Setup
        </TabBtn>
        <TabBtn active={tab === 'run'} onClick={() => switchTab('run')}>
          <Play size={12} />
          Run
        </TabBtn>
        <TabBtn active={tab === 'terminal'} onClick={() => switchTab('terminal')}>
          <TerminalSquare size={12} />
          Terminal
        </TabBtn>
        <button
          className="premium-toolbar-button ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-text-secondary"
          title="New terminal"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'setup' && <SetupPanel />}
        {tab === 'run' && <RunPanel />}
        {tab === 'terminal' && (
          <TerminalPanel ref={ref} visible={tab === 'terminal'} />
        )}
      </div>
    </div>
  );
});

function TabBtn({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`classic-tab-button flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium ${active ? 'classic-tab-button-active' : ''}`}
    >
      {children}
    </button>
  );
}

function SetupPanel() {
  return (
    <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
      Agent configuration and setup
    </div>
  );
}
