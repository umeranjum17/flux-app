import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, XCircle } from 'lucide-react';
import type { AgentMessage, SubagentState } from '../../lib/types';
import { MessageBubble } from './MessageBubble';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolResultBlock } from './ToolResultBlock';
import { ResultBlock } from './ResultBlock';
import { isPlanMessage } from '../../lib/plan';

interface SubagentBlockProps {
  subagents: Array<{
    id: string;
    state: SubagentState;
  }>;
  stage: 'running' | 'finished';
  taskMode?: 'plan' | 'act';
}

function formatTokens(total: number): string {
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total} tokens`;
}

function renderStatusIcon(status: SubagentState['status']) {
  if (status === 'spawning' || status === 'running') {
    return <Loader2 size={13} className="animate-spin text-accent shrink-0" />;
  }
  if (status === 'error') {
    return <XCircle size={13} className="text-error shrink-0" />;
  }
  return <CheckCircle2 size={13} className="text-success shrink-0" />;
}

export function SubagentBlock({ subagents, stage, taskMode }: SubagentBlockProps) {
  return (
    <div className="space-y-0.5">
      {subagents.map(({ id, state }) => (
        <SubagentRow key={id} id={id} state={state} taskMode={taskMode} />
      ))}
    </div>
  );
}

function SubagentRow({
  id,
  state,
  taskMode,
}: {
  id: string;
  state: SubagentState;
  taskMode?: 'plan' | 'act';
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMessages = state.messages.length > 0;

  return (
    <div className="tool-call-row group">
      <button
        onClick={() => hasMessages && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-1 px-1 text-left rounded-md hover:bg-bg-hover/40 transition-colors"
      >
        <span className="shrink-0 flex items-center justify-center w-5 h-5">
          {renderStatusIcon(state.status)}
        </span>
        <span className="text-[12px] font-medium text-text-secondary">Agent</span>
        <span className="text-[12px] text-text-tertiary truncate min-w-0">
          {state.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-tertiary/60 tabular-nums">
          {state.toolCount > 0 && `${state.toolCount} tools`}
        </span>
        {hasMessages && (
          <span className="shrink-0 text-text-tertiary/50 opacity-0 group-hover:opacity-100 transition-opacity">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasMessages && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-5 pr-1 pt-1 pb-2 space-y-0.5">
              <SubagentMessageList messages={state.messages} taskMode={taskMode} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubagentMessageList({
  messages,
  taskMode,
}: {
  messages: AgentMessage[];
  taskMode?: 'plan' | 'act';
}) {
  const mergedResultIndices = useMemo(() => {
    const merged = new Set<number>();
    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i];
      const next = messages[i + 1];
      if (
        current.type === 'tool_call' &&
        current.toolCallId &&
        next.type === 'tool_result' &&
        next.toolCallId === current.toolCallId
      ) {
        merged.add(i + 1);
      }
    }
    return merged;
  }, [messages]);

  return (
    <>
      {messages.map((message, index) => {
        if (mergedResultIndices.has(index)) return null;
        const mergedResult = mergedResultIndices.has(index + 1) ? messages[index + 1] : null;
        return (
          <div key={`${message.timestamp}-${index}`}>
            {renderSubagentMessage(message, mergedResult, taskMode)}
          </div>
        );
      })}
    </>
  );
}

function renderSubagentMessage(
  message: AgentMessage,
  mergedResult?: AgentMessage | null,
  taskMode?: 'plan' | 'act',
) {
  switch (message.type) {
    case 'text':
      return (
        <MessageBubble
          content={message.content}
          role={message.role as 'user' | 'assistant' | 'system'}
          images={message.images}
          attachments={message.attachments}
          highlightAsPlan={isPlanMessage(message, taskMode)}
        />
      );
    case 'thinking':
      return <ThinkingBlock content={message.content} active={message.subagentStatus === 'running'} />;
    case 'tool_call':
      return (
        <ToolCallBlock
          toolName={message.toolName ?? 'unknown'}
          toolInput={message.toolInput}
          toolCallId={message.toolCallId}
          content={message.content}
          isRunning={message.subagentStatus === 'running'}
          resultContent={mergedResult?.content}
          resultIsError={mergedResult?.isError}
          isComplete={!!mergedResult}
        />
      );
    case 'tool_result':
      return <ToolResultBlock content={message.content} isError={message.isError} toolCallId={message.toolCallId} />;
    case 'result':
      return (
        <ResultBlock
          costUsd={message.costUsd}
          inputTokens={message.inputTokens}
          outputTokens={message.outputTokens}
          durationMs={message.durationMs}
        />
      );
    case 'error':
      return <div className="rounded-md border border-error/30 bg-error/10 p-2 text-[12px] text-error">{message.content}</div>;
    default:
      return <div className="text-[12px] text-text-secondary">{message.content}</div>;
  }
}
