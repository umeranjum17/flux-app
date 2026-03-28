import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, FolderPlus, Monitor, Server, ChevronDown } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

interface ProjectMenuProps {
  onOpenProject: () => void;
  /** Render as compact icon-only trigger (kanban toolbar) vs labeled button */
  compact?: boolean;
  /** Which edge to align the dropdown to (default: 'right') */
  align?: 'left' | 'right';
}

const ITEMS = [
  {
    id: 'open',
    label: 'Open Project',
    description: 'Browse for an existing folder',
    icon: FolderOpen,
    group: 'local' as const,
  },
  {
    id: 'create',
    label: 'Create Project',
    description: 'Create a new local folder',
    icon: FolderPlus,
    group: 'local' as const,
  },
  {
    id: 'ssh',
    label: 'Connect via SSH',
    description: 'Remote host and path',
    icon: Server,
    group: 'remote' as const,
  },
] as const;

export function ProjectMenu({ onOpenProject, compact, align = 'right' }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Compute dropdown position from trigger button rect
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 260;
    const left = align === 'left'
      ? rect.left
      : rect.right - dropdownWidth;
    setPos({ top: rect.bottom + 6, left });
  }, [open, align]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      switch (id) {
        case 'open':
          onOpenProject();
          break;
        case 'create':
          useUiStore.getState().setOverlay('create-folder');
          break;
        case 'ssh':
          useUiStore.getState().setOverlay('connect-remote');
          break;
      }
    },
    [onOpenProject],
  );

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? 'premium-toolbar-button inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-bg-elevated/50 p-2 text-text-tertiary hover:text-text-primary transition-colors'
            : 'premium-toolbar-button inline-flex items-center gap-2 rounded-lg border border-border/70 bg-bg-surface/70 px-4 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors'
        }
        title="Open or create a project"
      >
        <Monitor size={compact ? 14 : 14} />
        {!compact && <>Add Project</>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''} ${compact ? 'ml-[-2px]' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-[260px] overflow-hidden rounded-xl border border-border/70 bg-bg-elevated shadow-xl shadow-black/20 backdrop-blur-xl"
          style={{ top: pos.top, left: pos.left }}
        >
          {/* Local group */}
          <div className="px-2 pt-2 pb-1">
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary/60">
              Local
            </span>
          </div>
          {ITEMS.filter((i) => i.group === 'local').map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-hover/80"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-hover/60 text-text-secondary">
                <item.icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-text-primary">{item.label}</span>
                <span className="block text-[11px] text-text-tertiary">{item.description}</span>
              </div>
            </button>
          ))}

          <div className="mx-3 my-1 border-t border-border/40" />

          {/* Remote group */}
          <div className="px-2 pb-1">
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary/60">
              Remote
            </span>
          </div>
          {ITEMS.filter((i) => i.group === 'remote').map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 pb-3 text-left transition-colors hover:bg-bg-hover/80"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-hover/60 text-text-secondary">
                <item.icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-text-primary">{item.label}</span>
                <span className="block text-[11px] text-text-tertiary">{item.description}</span>
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
