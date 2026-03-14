import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowRightLeft, X, Play, Copy, ClipboardList, Check } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { AgentId, AgentMessage, AgentHistoryEntry, Task } from '../../lib/types';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama',
};
import { MessageBubble } from './MessageBubble';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolResultBlock } from './ToolResultBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ApprovalPrompt } from './ApprovalPrompt';
import { QuestionPrompt } from './QuestionPrompt';
import { ResultBlock } from './ResultBlock';
import { StreamingCursor } from './StreamingCursor';
import { ActivityIndicator } from './ActivityIndicator';
import { SubagentBlock } from './SubagentBlock';
import { DiffBlock } from './DiffBlock';
import { PlanCard } from './PlanCard';

const messageVariants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0 },
};

const messageTransition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

function isSubagentMarker(msg: AgentMessage): boolean {
  return Boolean(msg.subagentId && msg.subagentStatus);
}

export function MessageList() {
  const task = useChatStore((s) => s.getActiveTask());
  const switchTaskAgent = useChatStore((s) => s.switchTaskAgent);
  const agents = useAgentStore((s) => s.agents);
  const messages = task?.messages ?? [];
  const subagents = task?.subagents ?? new Map();
  const agentHistory = task?.agentHistory ?? [];
  const rateLimitSuggestion = task?.rateLimitSuggestion;
  const diffs = task?.diffs ?? new Map();
  const taskStatus = task?.status;
  const taskId = task?.id;
  const isActiveRun = taskStatus === 'running' || taskStatus === 'waiting_approval' || taskStatus === 'waiting_input';

  const { containerRef, isAtBottom, scrollToBottom, handleScroll } =
    useAutoScroll([messages.length, messages[messages.length - 1]?.content]);

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        <p className="text-sm tracking-[0.02em]">Ask Flux anything...</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        <p className="text-sm tracking-[0.02em]">Ask Flux anything...</p>
      </div>
    );
  }

  const isStreaming = isActiveRun;
  const lastMessage = messages[messages.length - 1];
  const showCursor = isStreaming && lastMessage?.role === 'assistant' && lastMessage?.type === 'text';

  // Build set of message indices where agent switches happened
  const agentSwitchIndices = new Set(agentHistory.map((h) => h.fromMessageIndex));

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
        className="h-full overflow-y-auto px-4 py-5"
      >
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 font-mono">
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
                        transition={messageTransition}
                      >
                        <SubagentBlock subagents={group} stage={stage} taskMode={task.mode} />
                      </motion.div>,
                    );
                  }
                  idx = cursor - 1;
                  continue;
                }

                // Agent switch badge at boundary
                if (agentHistory.length > 0 && agentSwitchIndices.has(idx)) {
                  const switchEntry = agentHistory.find((h) => h.fromMessageIndex === idx);
                  if (switchEntry) {
                    const nextAgent = agentHistory.indexOf(switchEntry) < agentHistory.length - 1
                      ? agentHistory[agentHistory.indexOf(switchEntry) + 1]
                      : { agentId: task.agentId, model: task.model };
                    rendered.push(
                      <motion.div
                        key={`agent-switch-${idx}`}
                        variants={messageVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={messageTransition}
                      >
                        <div className="flex items-center gap-2 py-1 px-1">
                          <ArrowRightLeft size={12} className="text-text-tertiary" />
                          <span className="text-[11px] text-text-tertiary">
                            Switched from {AGENT_LABELS[switchEntry.agentId] ?? switchEntry.agentId} to {AGENT_LABELS[nextAgent.agentId] ?? nextAgent.agentId}
                          </span>
                        </div>
                      </motion.div>,
                    );
                  }
                }

                const mergedResult = mergedResultIndices.has(idx + 1) ? messages[idx + 1] : null;

                rendered.push(
                  <motion.div
                    key={`${msg.timestamp}-${idx}`}
                    variants={messageVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={messageTransition}
                  >
                    {taskId && renderMessage(msg, idx, taskId, taskStatus, mergedResult, task.mode)}
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

          {isActiveRun && task.currentStatus && (
            <ActivityIndicator
              label={task.currentStatus}
              statusKind={task.currentStatusKind}
              active
            />
          )}

          {diffs.size > 0 && (taskStatus === 'done' || taskStatus === 'error') && (
            <>
              {Array.from(diffs.entries()).map(([key, diff]) => (
                <div key={`diff-${key}`} className="mt-2">
                  <DiffBlock diff={diff} />
                </div>
              ))}
            </>
          )}

          {task.mode === 'plan' && taskId && (taskStatus === 'done' || isStreaming) && (
            <PlanCard task={task} isStreaming={isStreaming && task.mode === 'plan'} />
          )}

          {rateLimitSuggestion && taskId && (
            <div className="premium-panel flex items-center justify-between gap-3 rounded-[22px] border border-warning/25 p-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-warning font-medium">Rate limited.</span>
                <span className="text-text-secondary">Switch to another agent?</span>
              </div>
              <div className="flex items-center gap-1.5">
                {rateLimitSuggestion.agents
                  .filter((agentId) => agents.some((a) => a.id === agentId && a.available))
                  .slice(0, 3)
                  .map((agentId) => {
                    const agent = agents.find((a) => a.id === agentId);
                    return (
                      <button
                        key={agentId}
                        onClick={() => {
                          switchTaskAgent(taskId, agentId, agent?.models[0] ?? '');
                          useAgentStore.getState().setSelectedAgent(agentId);
                        }}
                        className="premium-toolbar-button rounded-full border border-accent/20 bg-accent-muted/40 px-3 py-1.5 text-xs font-medium text-accent"
                      >
                        {AGENT_LABELS[agentId] ?? agentId}
                      </button>
                    );
                  })}
                <button
                  onClick={() => {
                    useChatStore.setState((state) => {
                      const t = state.tasks.get(taskId);
                      if (t) t.rateLimitSuggestion = undefined;
                    });
                  }}
                  className="premium-toolbar-button rounded-xl p-1.5 text-text-tertiary"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isAtBottom && (
        <button
          onClick={scrollToBottom}
          className="premium-panel premium-toolbar-button absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full p-2.5"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} className="text-text-secondary" />
        </button>
      )}
    </div>
  );
}

function PlanActionBar({ task }: { task: Task }) {
  const [copied, setCopied] = React.useState(false);
  const setTaskStatus = useChatStore((s) => s.setTaskStatus);
  const setTaskMode = useChatStore((s) => s.setTaskMode);

  const handleImplement = async () => {
    setTaskMode(task.id, 'act');
    useUiStore.getState().setMode('act');
    setTaskStatus(task.id, 'running');
    await window.api.invoke('task:spawn', {
      taskId: task.id,
      prompt: 'Implement the plan above.',
      agentId: task.agentId,
      model: task.model,
      mode: 'act',
      thinking: task.thinking,
      cwd: task.cwd,
      sessionId: task.sessionId,
    });
  };

  const handleCopyPlan = () => {
    const planText = task.messages
      .filter((m) => m.role === 'assistant' && m.type === 'text')
      .map((m) => m.content)
      .join('\n\n');
    navigator.clipboard.writeText(planText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <ClipboardList size={14} className="text-accent" />
        <span>Plan complete</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopyPlan}
          className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-1.5"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy Plan'}
        </button>
        <button
          onClick={handleImplement}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5"
        >
          <Play size={12} />
          Implement Plan
        </button>
      </div>
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
          diff={msg.diff}
          filePath={msg.filePath}
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
