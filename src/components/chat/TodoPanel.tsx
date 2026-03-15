import React, { useState, useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TodoItem } from '../../lib/types';

interface TodoPanelProps {
  items: TodoItem[];
}

export function TodoPanel({ items }: TodoPanelProps) {
  const [showCompleted, setShowCompleted] = useState(false);

  const { done, inProgress, pending } = useMemo(() => {
    const done: TodoItem[] = [];
    const inProgress: TodoItem[] = [];
    const pending: TodoItem[] = [];
    for (const item of items) {
      if (item.status === 'done') done.push(item);
      else if (item.status === 'in_progress') inProgress.push(item);
      else pending.push(item);
    }
    return { done, inProgress, pending };
  }, [items]);

  if (items.length === 0) return null;

  const doneCount = done.length;
  const total = items.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  return (
    <div className="premium-panel overflow-hidden rounded-xl border border-border/50">
      {/* Header with progress */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Circular progress indicator */}
        <div className="relative h-9 w-9 shrink-0">
          <svg className="h-9 w-9 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18" cy="18" r="15"
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="2.5"
              opacity="0.3"
            />
            <circle
              cx="18" cy="18" r="15"
              fill="none"
              stroke={allDone ? 'var(--color-success)' : 'var(--color-accent)'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${pct * 0.942} 100`}
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-text-secondary">
            {pct}%
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text-primary">
            {allDone ? 'All steps completed' : `Step ${doneCount + 1} of ${total}`}
          </div>
          {inProgress.length > 0 && (
            <div className="text-[12px] text-text-tertiary truncate mt-0.5">
              {inProgress[0].label}
            </div>
          )}
        </div>

        <span className="text-[11px] text-text-quaternary tabular-nums shrink-0">
          {doneCount}/{total}
        </span>
      </div>

      {/* Active step - highlighted */}
      {inProgress.length > 0 && (
        <div className="mx-3 mb-2 rounded-lg bg-accent/[0.07] border border-accent/15 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <Loader2 size={16} className="text-accent animate-spin" />
            </div>
            <span className="text-[13px] font-medium text-text-primary">
              {inProgress[0].label}
            </span>
          </div>
        </div>
      )}

      {/* Pending steps */}
      {pending.length > 0 && (
        <div className="mx-3 mb-2 space-y-0.5">
          {pending.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <Circle size={14} className="shrink-0 text-text-quaternary" />
              <span className="text-[12px] text-text-tertiary">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Completed steps - collapsible */}
      {doneCount > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <CheckCircle2 size={13} className="text-success shrink-0" />
            <span>{doneCount} completed</span>
            <ChevronDown
              size={13}
              className={`ml-auto shrink-0 transition-transform duration-200 ${showCompleted ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence initial={false}>
            {showCompleted && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-2 space-y-0.5">
                  {done.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5 px-3 py-1">
                      <CheckCircle2 size={13} className="shrink-0 text-success/60" />
                      <span className="text-[12px] text-text-quaternary line-through">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Bottom progress bar */}
      <div className="h-[3px] bg-border/20">
        <div
          className={`h-full transition-all duration-500 ease-out ${allDone ? 'bg-success' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
