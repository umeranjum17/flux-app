import { useState, useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronUp, ListTodo } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  const currentLabel = inProgress.length > 0
    ? inProgress[0].label
    : pending.length > 0
      ? pending[0].label
      : 'All steps completed';

  return (
    <div className="mb-2">
      {/* Collapsed summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-2.5 rounded-lg border border-border/50 bg-bg-secondary/60 px-3 py-2 text-left transition-colors hover:bg-bg-secondary"
      >
        <ListTodo size={14} className="shrink-0 text-accent" />

        {/* Mini progress bar */}
        <div className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border/30">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out ${allDone ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <span className="text-[11px] tabular-nums text-text-tertiary shrink-0">
          {doneCount}/{total}
        </span>

        <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
          {currentLabel}
        </span>

        <ChevronUp
          size={13}
          className={`shrink-0 text-text-quaternary transition-transform duration-200 ${expanded ? '' : 'rotate-180'}`}
        />
      </button>

      {/* Expanded todo list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 rounded-lg border border-border/50 bg-bg-secondary/60 py-1.5">
              {/* In-progress items */}
              {inProgress.map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5">
                  <Loader2 size={14} className="shrink-0 text-accent animate-spin" />
                  <span className="text-[12px] font-medium text-text-primary">{item.label}</span>
                </div>
              ))}

              {/* Pending items */}
              {pending.map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5">
                  <Circle size={14} className="shrink-0 text-text-quaternary" />
                  <span className="text-[12px] text-text-tertiary">{item.label}</span>
                </div>
              ))}

              {/* Done items */}
              {done.map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5">
                  <CheckCircle2 size={14} className="shrink-0 text-success/60" />
                  <span className="text-[12px] text-text-quaternary line-through">{item.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
