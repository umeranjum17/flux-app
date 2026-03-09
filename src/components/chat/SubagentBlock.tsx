import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import type { AgentMessage, SubagentState } from '../../lib/types';
import { MessageBubble } from './MessageBubble';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolResultBlock } from './ToolResultBlock';
import { ResultBlock } from './ResultBlock';

interface SubagentBlockProps {
  subagents: Array<{
    id: string;
    state: SubagentState;
  }>;
  stage: 'running' | 'finished';
  taskMode?: 'plan' | 'act';
}

function formatTokens(total: number): string {
  if (total >= 1000) {
    return `${(total / 1000).toFixed(1)}k tokens`;
  }
  return `${total} tokens`;
}

function renderStatusIcon(status: SubagentState['status']) {
  if (status === 'spawning' || status === 'running') {
    return <Loader2 size={13} className="animate-spin text-text-tertiary shrink-0" />;
  }
  if (status === 'error') {
    return <XCircle size={13} className="text-error shrink-0" />;
  }
  return <CheckCircle2 size={13} className="text-success shrink-0" />;
}

export function SubagentBlock({ subagents, stage, taskMode }: SubagentBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const title = stage === 'running'
    ? `Running ${subagents.length} agent${subagents.length === 1 ? '' : 's'}...`
    : `${subagents.length} agent${subagents.length === 1 ? '' : 's'} finished`;

  return (
    <div className="rounded-lg border border-border bg-bg-elevated/60">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
        )}
        <span className="text-sm text-text-primary">{title}</span>
      </button>

      <div className="space-y-1 px-3 pb-3">
        {subagents.map(({ id, state }, index) => {
          const connector = index === subagents.length - 1 ? '└─' : '├─';
          return (
            <div key={id} className="rounded-md border-l border-border/70 pl-3">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="font-mono text-text-tertiary">{connector}</span>
                {renderStatusIcon(state.status)}
                <span className="truncate text-text-primary">{state.name}</span>
                <span className="ml-auto shrink-0 text-xs text-text-tertiary">
                  {state.toolCount} tool {state.toolCount === 1 ? 'use' : 'uses'} · {formatTokens(state.inputTokens + state.outputTokens)}
                </span>
              </div>

              {expanded && state.messages.length > 0 && (
                <div className="mt-2 space-y-2 pb-1">
                  <SubagentMessageList messages={state.messages} taskMode={taskMode} />
                </div>
              )}
            </div>
          );
        })}
      </div>
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
          <div key={`${message.timestamp}-${index}`} className="pl-5">
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
          mode={taskMode}
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
      return <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{message.content}</div>;
    default:
      return <div className="text-sm text-text-secondary">{message.content}</div>;
  }
}
