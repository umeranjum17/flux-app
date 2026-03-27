import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TaskMode } from '../../lib/types';

const MODE_ORDER: TaskMode[] = ['plan', 'act', 'ask', 'architect'];

const MODE_META: Record<TaskMode, { label: string; description: string }> = {
  plan: { label: 'Plan', description: 'Read & plan without making changes' },
  act: { label: 'Act', description: 'Make changes directly' },
  ask: { label: 'Ask', description: 'Answer questions without modifications' },
  architect: { label: 'Architect', description: 'Analyze & propose high-level designs' },
};

interface ModeDropdownProps {
  mode: TaskMode;
  onModeChange: (mode: TaskMode) => void;
}

export function ModeDropdown({ mode, onModeChange }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape, keyboard nav
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, MODE_ORDER.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < MODE_ORDER.length) {
          onModeChange(MODE_ORDER[focusIdx]);
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    },
    [open, focusIdx, onModeChange],
  );

  const meta = MODE_META[mode];

  return (
    <div ref={ref} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setFocusIdx(MODE_ORDER.indexOf(mode));
        }}
        className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-bg-elevated/50 px-2.5 py-0.5 text-[11px] font-semibold text-text-primary transition-all duration-150 hover:bg-bg-hover"
        title="Shift+Tab to cycle modes"
      >
        {meta.label}
        <ChevronDown size={10} className="text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-lg border border-border/60 bg-bg-secondary shadow-lg">
          {MODE_ORDER.map((m, i) => {
            const info = MODE_META[m];
            const isActive = m === mode;
            const isFocused = i === focusIdx;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onModeChange(m);
                  setOpen(false);
                }}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  isFocused
                    ? 'bg-bg-hover'
                    : 'hover:bg-bg-hover'
                } ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
              >
                <span className="flex items-center gap-2 text-[12px] font-semibold">
                  {info.label}
                  {isActive && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </span>
                <span className="text-[11px] text-text-tertiary">{info.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Cycle to the next mode in order. */
export function nextTaskMode(current: TaskMode): TaskMode {
  const idx = MODE_ORDER.indexOf(current);
  return MODE_ORDER[(idx + 1) % MODE_ORDER.length];
}
