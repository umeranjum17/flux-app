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
  const summaryParts = useMemo(() => summarizeGroupParts(items), [items]);
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
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:bg-bg-hover/40"
      >
        <span className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${hasRunningItems ? 'bg-bg-hover/50' : dominantIcon.bg}`}>
          {hasRunningItems ? (
            <Loader2 size={11} className="shrink-0 animate-spin text-text-tertiary" />
          ) : (
            <dominantIcon.Icon size={11} className={`shrink-0 ${dominantIcon.color}`} />
          )}
        </span>
        <span className="text-[11px] font-medium text-text-secondary/80">{label}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] text-text-tertiary/60">
          {summaryParts.map((part, i) => (
            <React.Fragment key={part.toolName}>
              {i > 0 && <span>·</span>}
              <span className="inline-flex items-center gap-0.5">
                <part.Icon size={10} className={part.color} />
                {part.count > 1 ? `${part.label} x${part.count}` : part.label}
              </span>
            </React.Fragment>
          ))}
          {summaryParts.length === 0 && ''}
        </span>
        <span className="shrink-0 rounded-full bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">{items.length}</span>
        <span className="ml-1 shrink-0 text-text-tertiary/70">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
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
            <div className="space-y-0.5 pl-4 pr-1 pt-1 pb-2">
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

interface SummaryPart {
  toolName: string;
  label: string;
  count: number;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
}

function summarizeGroupParts(items: ToolCallGroupItem[]): SummaryPart[] {
  const toolCounts = new Map<string, number>();
  for (const item of items) {
    const name = item.message.toolName ?? 'Unknown';
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }

  return Array.from(toolCounts.entries())
    .slice(0, 4)
    .map(([toolName, count]) => {
      const icon = getToolIcon(toolName);
      return {
        toolName,
        label: formatToolCallLabel(toolName),
        count,
        Icon: icon.Icon,
        color: icon.color,
      };
    });
}
