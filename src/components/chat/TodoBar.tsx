import { useState, useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import type { TodoItem } from '../../lib/types';

export function TodoBar() {
  const task = useChatStore((s) => s.getActiveTask());
  const items = task?.todoItems;

  if (!items || items.length === 0) return null;

  return <TodoBarInner items={items} />;
}

function TodoBarInner({ items }: { items: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);

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

  const doneCount = done.length;
  const total = items.length;
  const allDone = doneCount === total;
  const canExpand = items.length > 1;

  const currentLabel = allDone
    ? 'All checklist items complete'
    : inProgress.length > 0
    ? inProgress[0].label
    : pending.length > 0
      ? pending[0].label
      : 'Checklist';

  const summaryIcon = allDone
    ? <CheckCircle2 size={14} className="shrink-0 text-success" />
    : inProgress.length > 0
      ? <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
      : <Circle size={14} className="shrink-0 text-text-quaternary" />;

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => {
          if (!canExpand) return;
          setExpanded((current) => !current);
        }}
        className={`flex w-full items-center gap-2.5 border border-border/60 bg-bg-secondary/35 px-3 py-2 text-left transition-colors hover:bg-bg-secondary/50 ${
          expanded && canExpand ? 'rounded-t-lg rounded-b-none border-b-border/40' : 'rounded-lg'
        }`}
        aria-expanded={expanded}
        aria-label="Toggle checklist details"
      >
        {summaryIcon}

        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
          {currentLabel}
        </span>

        <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">
          {doneCount}/{total}
        </span>

        {canExpand && (
          <ChevronDown
            size={13}
            className={`shrink-0 text-text-quaternary transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expanded && canExpand && (
        <div className="overflow-hidden rounded-b-lg border-x border-b border-border/60 bg-bg-secondary/20 px-3 py-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 py-1.5">
              {item.status === 'done' && <CheckCircle2 size={14} className="shrink-0 text-success/70" />}
              {item.status === 'in_progress' && <Loader2 size={14} className="shrink-0 animate-spin text-accent" />}
              {item.status === 'pending' && <Circle size={14} className="shrink-0 text-text-quaternary" />}
              <span
                className={`text-[12px] ${
                  item.status === 'done'
                    ? 'text-text-quaternary line-through'
                    : item.status === 'in_progress'
                      ? 'font-medium text-text-primary'
                      : 'text-text-tertiary'
                }`}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
