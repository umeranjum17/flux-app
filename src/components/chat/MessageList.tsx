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
import { ResultBlock } from './ResultBlock';
import { StreamingCursor } from './StreamingCursor';

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

export function MessageList() {
  const task = useChatStore((s) => s.getActiveTask());
  const messages = task?.messages ?? [];
  const taskStatus = task?.status;
  const taskId = task?.id;

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

  const isStreaming = taskStatus === 'running';
  const lastMessage = messages[messages.length - 1];
  const showCursor = isStreaming && lastMessage?.role === 'assistant' && lastMessage?.type === 'text';

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 space-y-3"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={`${msg.timestamp}-${idx}`}
              variants={messageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15 }}
            >
              {renderMessage(msg, idx, taskId!, taskStatus)}
              {isFileEditToolCall(msg) && (
                <div className="mt-2">
                  <FileEditBlock
                    diff={msg.diff}
                    filePath={msg.filePath ?? (msg.toolInput?.file_path as string | undefined) ?? (msg.toolInput?.path as string | undefined)}
                    toolName={msg.toolName}
                  />
                </div>
              )}
            </motion.div>
          ))}
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
          className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bg-elevated border border-border rounded-full p-2 shadow-lg hover:bg-bg-hover transition-colors"
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
) {
  switch (msg.type) {
    case 'text':
      return <MessageBubble content={msg.content} role={msg.role as 'user' | 'assistant' | 'system'} images={msg.images} />;

    case 'tool_call':
      return (
        <ToolCallBlock
          toolName={msg.toolName ?? 'unknown'}
          toolInput={msg.toolInput}
          toolCallId={msg.toolCallId}
          content={msg.content}
          isRunning={taskStatus === 'running'}
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
      return <ThinkingBlock content={msg.content} />;

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

    default:
      return (
        <div className="text-text-secondary text-sm">
          {msg.content}
        </div>
      );
  }
}
