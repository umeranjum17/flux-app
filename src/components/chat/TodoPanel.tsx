import React from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { TodoItem } from '../../lib/types';

interface TodoPanelProps {
  items: TodoItem[];
}

export function TodoPanel({ items }: TodoPanelProps) {
  if (items.length === 0) return null;

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <div className="premium-panel overflow-hidden rounded-lg border border-border/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[13px] font-medium text-text-primary">Progress</span>
        <span className="text-xs text-text-tertiary">
          {doneCount}/{items.length} steps
        </span>
      </div>
      <div className="px-4 py-2.5 space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-2 text-sm"
          >
            {item.status === 'done' ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
            ) : item.status === 'in_progress' ? (
              <Loader2 size={15} className="mt-0.5 shrink-0 text-plan animate-spin" />
            ) : (
              <Circle size={15} className="mt-0.5 shrink-0 text-text-quaternary" />
            )}
            <span
              className={
                item.status === 'done'
                  ? 'text-text-tertiary line-through'
                  : item.status === 'in_progress'
                    ? 'text-text-primary font-medium'
                    : 'text-text-secondary'
              }
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="h-1 bg-border/40">
        <div
          className="h-full bg-success transition-all duration-300"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
