import type { ComponentType, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FileText,
  Loader2,
  Search,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { AgentMessage } from '../../lib/types';
import { ToolCallBlock } from './ToolCallBlock';

const EXPAND_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
};

export interface ToolCallGroupEntry {
  message: AgentMessage;
  mergedResult?: AgentMessage | null;
  isRunning?: boolean;
  forceExpanded?: boolean;
}

type ToolKind = 'edit' | 'read' | 'search' | 'command' | 'agent' | 'other';

const TOOL_KIND_META: Record<ToolKind, {
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  className: string;
}> = {
  edit: {
    label: 'edits',
    Icon: FilePenLine,
    className: 'text-info',
  },
  read: {
    label: 'reads',
    Icon: FileText,
    className: 'text-info',
  },
  search: {
    label: 'searches',
    Icon: Search,
    className: 'text-success',
  },
  command: {
    label: 'commands',
    Icon: Terminal,
    className: 'text-warning',
  },
  agent: {
    label: 'agents',
    Icon: Bot,
    className: 'text-accent',
  },
  other: {
    label: 'tools',
    Icon: Wrench,
    className: 'text-text-tertiary',
  },
};

export function isStructuredTodoToolCall(msg: Pick<AgentMessage, 'type' | 'toolName' | 'toolInput'>): boolean {
  if (msg.type !== 'tool_call') return false;
  const toolNameLower = (msg.toolName ?? '').toLowerCase();
  const hasStructuredTodoPayload = Boolean(
    msg.toolInput
    && (Array.isArray(msg.toolInput.todos) || Array.isArray(msg.toolInput.plan)),
  );
  return toolNameLower.includes('todo') || toolNameLower === 'update_plan' || hasStructuredTodoPayload;
}

export function buildMergedToolResultLookup(messages: AgentMessage[]) {
  const mergedResultIndices = new Set<number>();
  const mergedResultForCall = new Map<number, AgentMessage>();
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_call' || !msg.toolCallId) continue;
    for (let j = i + 1; j < messages.length; j++) {
      const candidate = messages[j];
      if (candidate.type === 'status' && candidate.toolCallId === msg.toolCallId) continue;
      if (candidate.type === 'tool_result' && candidate.toolCallId === msg.toolCallId) {
        mergedResultIndices.add(j);
        mergedResultForCall.set(i, candidate);
      }
      break;
    }
  }
  return { mergedResultIndices, mergedResultForCall };
}

export function collectConsecutiveToolCallEntries(
  messages: AgentMessage[],
  startIndex: number,
  mergedResultIndices: Set<number>,
  mergedResultForCall: Map<number, AgentMessage>,
  options?: {
    isRunning?: (message: AgentMessage) => boolean;
    expandedToolCallIds?: Set<string>;
    stopAtIndex?: (index: number, message: AgentMessage) => boolean;
  },
): { entries: ToolCallGroupEntry[]; nextIndex: number } {
  const entries: ToolCallGroupEntry[] = [];
  let cursor = startIndex;

  while (cursor < messages.length) {
    if (mergedResultIndices.has(cursor)) {
      cursor += 1;
      continue;
    }

    const message = messages[cursor];
    if (cursor !== startIndex && options?.stopAtIndex?.(cursor, message)) break;
    if (message.type !== 'tool_call' || isStructuredTodoToolCall(message)) break;

    entries.push({
      message,
      mergedResult: mergedResultForCall.get(cursor) ?? null,
      isRunning: options?.isRunning?.(message) ?? false,
      forceExpanded: message.toolCallId ? options?.expandedToolCallIds?.has(message.toolCallId) : undefined,
    });
    cursor += 1;
  }

  return {
    entries,
    nextIndex: Math.max(startIndex, cursor - 1),
  };
}

export function ToolCallGroup({ entries }: { entries: ToolCallGroupEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasForcedExpansion = entries.some((entry) => entry.forceExpanded);
  const isExpanded = expanded || hasForcedExpansion;

  const summary = useMemo(() => summarizeEntries(entries), [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="tool-call-row rounded-lg border border-border/50 bg-bg-surface/35">
      <button
        type="button"
        data-tool-call-group
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {summary.statusIcon}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-text-secondary">
          Tool run
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-text-tertiary">
          {summary.description}
        </span>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          {summary.badges.map(({ kind, count }) => {
            const meta = TOOL_KIND_META[kind];
            const Icon = meta.Icon;
            return (
              <span
                key={kind}
                className="inline-flex items-center gap-1 rounded-full bg-bg-tertiary/80 px-1.5 py-0.5 text-[10px] text-text-tertiary"
              >
                <Icon size={10} className={meta.className} />
                {count}
              </span>
            );
          })}
        </div>
        <span className="shrink-0 text-text-tertiary/60 transition-opacity group-hover:text-text-tertiary">
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND_TRANSITION}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-border/40 px-2 py-1.5">
              {entries.map((entry, index) => (
                <ToolCallBlock
                  key={entry.message._seqId ?? `${entry.message.timestamp}-${index}`}
                  toolName={entry.message.toolName ?? 'unknown'}
                  toolInput={entry.message.toolInput}
                  toolCallId={entry.message.toolCallId}
                  content={entry.message.content}
                  isRunning={entry.isRunning}
                  resultContent={entry.mergedResult?.content}
                  resultIsError={entry.mergedResult?.isError}
                  isComplete={!!entry.mergedResult}
                  diff={entry.message.diff}
                  filePath={entry.message.filePath}
                  forceExpanded={entry.forceExpanded}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function summarizeEntries(entries: ToolCallGroupEntry[]) {
  const total = entries.length;
  const runningCount = entries.filter((entry) => entry.isRunning && !entry.mergedResult).length;
  const errorCount = entries.filter((entry) => entry.mergedResult?.isError).length;
  const kindCounts = new Map<ToolKind, number>();

  for (const entry of entries) {
    const kind = getToolKind(entry.message.toolName);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }

  const badges = Array.from(kindCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([kind, count]) => ({ kind, count }));

  const detailParts = [`${total} call${total === 1 ? '' : 's'}`];
  if (errorCount > 0) {
    detailParts.push(`${errorCount} failed`);
  } else if (runningCount > 0) {
    detailParts.push(runningCount === 1 ? '1 running' : `${runningCount} running`);
  } else {
    detailParts.push('completed');
  }
  if (badges.length > 0) {
    detailParts.push(
      badges
        .map(({ kind, count }) => `${count} ${TOOL_KIND_META[kind].label}`)
        .join(' · '),
    );
  }

  let statusIcon: ReactNode = <CheckCircle2 size={13} className="shrink-0 text-success" />;
  if (errorCount > 0) {
    statusIcon = <XCircle size={13} className="shrink-0 text-error" />;
  } else if (runningCount > 0) {
    statusIcon = <Loader2 size={13} className="shrink-0 animate-spin text-accent" />;
  }

  return {
    description: detailParts.join(' · '),
    badges,
    statusIcon,
  };
}

function getToolKind(toolName?: string): ToolKind {
  const name = (toolName ?? '').toLowerCase();
  if (name.includes('edit') || name.includes('write') || name.includes('patch')) return 'edit';
  if (name.includes('read') || name.includes('view')) return 'read';
  if (name.includes('grep') || name.includes('search') || name.includes('glob') || name.includes('find')) return 'search';
  if (name.includes('bash') || name.includes('command') || name.includes('shell')) return 'command';
  if (name.includes('agent')) return 'agent';
  return 'other';
}
