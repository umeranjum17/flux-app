import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { AgentMessage } from '../../lib/types';
import { formatToolCallLabel } from '../../lib/tool-call-display';
import { ToolCallBlock, getToolIcon } from './ToolCallBlock';

const EXPAND_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
};

export interface ToolCallGroupItem {
  message: AgentMessage;
  mergedResult?: AgentMessage | null;
  isRunning?: boolean;
  key: string;
}

interface ToolCallGroupProps {
  items: ToolCallGroupItem[];
  label?: string;
}

export function ToolCallGroup({ items, label = 'Tool activity' }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeGroup(items), [items]);
  const hasRunningItems = items.some((item) => item.isRunning && !item.mergedResult);

  const dominantIcon = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const name = item.message.toolName ?? 'unknown';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let best = 'unknown';
    let bestCount = 0;
    for (const [name, count] of counts) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    return getToolIcon(best);
  }, [items]);

  return (
    <div className="tool-call-row group">
      <button
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-bg-hover/40"
      >
        <span className={`tool-icon-badge w-5 h-5 rounded ${hasRunningItems ? 'bg-bg-hover/50' : dominantIcon.bg}`}>
          {hasRunningItems ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-text-tertiary" />
          ) : (
            <dominantIcon.Icon size={12} className={`shrink-0 ${dominantIcon.color}`} />
          )}
        </span>
        <span className="text-[12px] font-medium text-text-secondary">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">{summary}</span>
        <span className="shrink-0 rounded-full bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">{items.length}</span>
        <span className="ml-1 shrink-0 text-text-tertiary/70">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND_TRANSITION}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pl-5 pr-1 pt-1 pb-2">
              {items.map((item) => (
                <ToolCallBlock
                  key={item.key}
                  toolName={item.message.toolName ?? 'unknown'}
                  toolInput={item.message.toolInput}
                  toolCallId={item.message.toolCallId}
                  content={item.message.content}
                  isRunning={item.isRunning}
                  resultContent={item.mergedResult?.content}
                  resultIsError={item.mergedResult?.isError}
                  isComplete={!!item.mergedResult}
                  diff={item.message.diff}
                  filePath={item.message.filePath}
                  importance="routine"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function summarizeGroup(items: ToolCallGroupItem[]): string {
  const labels = new Map<string, number>();
  for (const item of items) {
    const label = formatToolCallLabel(item.message.toolName ?? 'Unknown');
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }

  const parts = Array.from(labels.entries())
    .slice(0, 3)
    .map(([label, count]) => (count > 1 ? `${label} x${count}` : label));

  if (labels.size > 3) {
    parts.push(`+${labels.size - 3} more`);
  }

  return parts.join(' · ');
}
