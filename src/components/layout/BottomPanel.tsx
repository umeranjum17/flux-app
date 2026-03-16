import { forwardRef, useState, useCallback, useRef } from 'react';
import { GripHorizontal } from 'lucide-react';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';

export const BottomPanel = forwardRef<TerminalPanelHandle>(function BottomPanel(_props, ref) {
  const [height, setHeight] = useState(176);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

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

      <div className="flex-1 overflow-hidden">
        <TerminalPanel ref={ref} visible />
      </div>
    </div>
  );
});
