import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { AgentMessage } from '../../lib/types';
import { MessageBubble } from './MessageBubble';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolResultBlock } from './ToolResultBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { FileEditBlock } from './FileEditBlock';
import { ApprovalPrompt } from './ApprovalPrompt';
import { QuestionPrompt } from './QuestionPrompt';
import { ResultBlock } from './ResultBlock';
import { StreamingCursor } from './StreamingCursor';
import { ActivityIndicator } from './ActivityIndicator';
import { SubagentBlock } from './SubagentBlock';

const messageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

function isFileEditToolCall(msg: AgentMessage): boolean {
  if (msg.type !== 'tool_call' || !msg.toolName) return false;
  const name = msg.toolName.toLowerCase();
  return name.includes('edit') || name.includes('write');
}

function isSubagentMarker(msg: AgentMessage): boolean {
  return Boolean(msg.subagentId && msg.subagentStatus);
}

export function MessageList() {
  const task = useChatStore((s) => s.getActiveTask());
  const messages = task?.messages ?? [];
  const subagents = task?.subagents ?? new Map();
  const taskStatus = task?.status;
  const taskId = task?.id;
  const isActiveRun = taskStatus === 'running' || taskStatus === 'waiting_approval' || taskStatus === 'waiting_input';

  const { containerRef, isAtBottom, scrollToBottom, handleScroll } =
    useAutoScroll([messages.length, messages[messages.length - 1]?.content]);

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary">
        <p className="text-lg">Ask Flux anything...</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary">
        <p className="text-lg">Ask Flux anything...</p>
      </div>
    );
  }

  const isStreaming = isActiveRun;
  const lastMessage = messages[messages.length - 1];
  const showCursor = isStreaming && lastMessage?.role === 'assistant' && lastMessage?.type === 'text';

  // Build a set of tool_result indices that are merged into their preceding tool_call
  const mergedResultIndices = new Set<number>();
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const next = messages[i + 1];
    if (
      msg.type === 'tool_call' &&
      next.type === 'tool_result' &&
      next.toolCallId &&
      msg.toolCallId &&
      next.toolCallId === msg.toolCallId
    ) {
      mergedResultIndices.add(i + 1);
    }
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-5 py-5 space-y-4"
      >
        <AnimatePresence initial={false}>
          {(() => {
            const rendered: React.ReactNode[] = [];
            for (let idx = 0; idx < messages.length; idx++) {
              const msg = messages[idx];
              if (mergedResultIndices.has(idx)) continue;

              if (isSubagentMarker(msg)) {
                const groupIds: string[] = [];
                let cursor = idx;
                while (cursor < messages.length && isSubagentMarker(messages[cursor])) {
                  if (messages[cursor].subagentId) {
                    groupIds.push(messages[cursor].subagentId!);
                  }
                  cursor += 1;
                }
                const uniqueIds = Array.from(new Set(groupIds));
                const group = uniqueIds
                  .map((id) => {
                    const state = subagents.get(id);
                    return state ? { id, state } : null;
                  })
                  .filter((entry): entry is { id: string; state: NonNullable<typeof entry>['state'] } => !!entry);

                if (group.length > 0) {
                  const stage = msg.subagentStatus === 'done' || msg.subagentStatus === 'error' ? 'finished' : 'running';
                  rendered.push(
                    <motion.div
                      key={`subagent-group-${msg.timestamp}-${idx}`}
                      variants={messageVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={{ duration: 0.15 }}
                    >
                      <SubagentBlock subagents={group} stage={stage} taskMode={task.mode} />
                    </motion.div>,
                  );
                }
                idx = cursor - 1;
                continue;
              }

              const mergedResult = mergedResultIndices.has(idx + 1) ? messages[idx + 1] : null;

              rendered.push(
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  variants={messageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.15 }}
                >
                  {renderMessage(msg, idx, taskId!, taskStatus, mergedResult, task.mode)}
                  {isFileEditToolCall(msg) && (
                    <div className="mt-2">
                      <FileEditBlock
                        diff={msg.diff}
                        filePath={msg.filePath ?? (msg.toolInput?.file_path as string | undefined) ?? (msg.toolInput?.path as string | undefined)}
                        toolName={msg.toolName}
                      />
                    </div>
                  )}
                </motion.div>,
              );
            }
            return rendered;
          })()}
        </AnimatePresence>

        {showCursor && (
          <div className="pl-1">
            <StreamingCursor />
          </div>
        )}
      </div>

      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bg-elevated/90 rounded-full p-2 shadow-lg hover:bg-bg-hover transition-colors"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} className="text-text-secondary" />
        </button>
      )}
    </div>
  );
}

function renderMessage(
  msg: AgentMessage,
  _idx: number,
  taskId: string,
  taskStatus?: string,
  mergedResult?: AgentMessage | null,
  taskMode?: string,
) {
  const isActiveRun = taskStatus === 'running' || taskStatus === 'waiting_approval' || taskStatus === 'waiting_input';

  switch (msg.type) {
    case 'text':
      return (
        <MessageBubble
          content={msg.content}
          role={msg.role as 'user' | 'assistant' | 'system'}
          images={msg.images}
          attachments={msg.attachments}
          mode={taskMode as 'plan' | 'act' | undefined}
        />
      );

    case 'status':
      return (
        <ActivityIndicator
          label={msg.content}
          statusKind={msg.statusKind}
          active={isActiveRun}
        />
      );

    case 'tool_call':
      return (
        <ToolCallBlock
          toolName={msg.toolName ?? 'unknown'}
          toolInput={msg.toolInput}
          toolCallId={msg.toolCallId}
          content={msg.content}
          isRunning={isActiveRun}
          resultContent={mergedResult?.content}
          resultIsError={mergedResult?.isError}
          isComplete={!!mergedResult}
        />
      );

    case 'tool_result':
      return (
        <ToolResultBlock
          content={msg.content}
          isError={msg.isError}
          toolCallId={msg.toolCallId}
        />
      );

    case 'thinking':
      return <ThinkingBlock content={msg.content} active={isActiveRun} />;

    case 'error':
      return (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-error text-sm">
          {msg.content}
        </div>
      );

    case 'result':
      return (
        <ResultBlock
          costUsd={msg.costUsd}
          inputTokens={msg.inputTokens}
          outputTokens={msg.outputTokens}
          durationMs={msg.durationMs}
        />
      );

    case 'quality_gate':
      return (
        <div className={`rounded-lg border p-3 text-sm ${
          msg.passed
            ? 'border-success/30 bg-success/10 text-text-primary'
            : 'border-error/30 bg-error/10 text-text-primary'
        }`}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {msg.passed ? 'Quality gate passed' : 'Quality gate failed'}
            </span>
            {typeof msg.exitCode === 'number' && (
              <span className="text-xs text-text-tertiary">exit {msg.exitCode}</span>
            )}
          </div>
          {msg.command && (
            <div className="mt-1 font-mono text-xs text-text-secondary">{msg.command}</div>
          )}
          {(msg.stderr || msg.stdout) && (
            <pre className="mt-2 overflow-x-auto rounded bg-bg-primary/70 p-2 text-xs text-text-secondary whitespace-pre-wrap">
              {(msg.stderr || msg.stdout || '').trim()}
            </pre>
          )}
        </div>
      );

    case 'permission_request':
      return (
        <ApprovalPrompt
          requestId={msg.requestId!}
          toolName={msg.toolName ?? 'unknown'}
          description={msg.content}
          action={msg.action}
          path={msg.filePath}
          taskId={taskId}
        />
      );

    case 'question_request':
      return (
        <QuestionPrompt
          taskId={taskId}
          requestId={msg.requestId ?? `question-${msg.timestamp}`}
          prompt={msg.content}
          questions={msg.questions ?? []}
          allowFreeform={msg.allowFreeform}
          placeholder={msg.placeholder}
        />
      );

    case 'rate_limit':
      return null;

    default:
      return (
        <div className="text-text-secondary text-sm">
          {msg.content}
        </div>
      );
  }
}
