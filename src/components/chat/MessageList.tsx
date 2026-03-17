import React, { useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowRightLeft, X, Play, Copy, ClipboardList, Check } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import type { AgentId, AgentMessage, AgentHistoryEntry, SystemActivity, Task } from '../../lib/types';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama',
};
import { MessageBubble } from './MessageBubble';
import { ToolCallBlock } from './ToolCallBlock';
import { ToolResultBlock } from './ToolResultBlock';
import { LifecycleCard } from './LifecycleCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ApprovalPrompt } from './ApprovalPrompt';
import { QuestionPrompt } from './QuestionPrompt';
import { ResultBlock } from './ResultBlock';
import { StreamingCursor } from './StreamingCursor';
import { ActivityIndicator } from './ActivityIndicator';
import { SubagentBlock } from './SubagentBlock';
import { TaskFooter } from './TaskFooter';
import { PlanCard } from './PlanCard';
import { ShellResultBlock } from './ShellResultBlock';
import { CompletionCard, useWorkspaceCompletion } from './CompletionCard';
import { SystemActivityInlineItem, SystemActivityGroup, groupActivitiesByCategory } from './SystemActivityFeed';
import { useWorkspaceStore } from '../../stores/workspace';
import { getLatestPlanText, isPlanMessage, stripFluxTokens } from '../../lib/plan';
import { normalizeTrackedFilePath } from '../../lib/path-utils';

const messageVariants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0 },
};

const messageTransition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1] as const,
};

const EMPTY_SYSTEM_ACTIVITIES: SystemActivity[] = [];

function mergeDiffEntries(
  diffs: Map<string, import('../../lib/types').DiffData>,
  cwd?: string,
): import('../../lib/types').DiffData | undefined {
  if (diffs.size === 0) return undefined;

  const mergedByPath = new Map<string, import('../../lib/types').DiffFileEntry>();
  for (const diff of diffs.values()) {
    for (const file of diff.files) {
      const normalizedPath = normalizeTrackedFilePath(file.path, cwd);
      const existing = mergedByPath.get(normalizedPath);
      if (!existing) {
        mergedByPath.set(normalizedPath, {
          ...file,
          path: normalizedPath,
        });
        continue;
      }
      mergedByPath.set(normalizedPath, {
        ...existing,
        additions: Math.max(existing.additions, file.additions),
        deletions: Math.max(existing.deletions, file.deletions),
      });
    }
  }

  const files = Array.from(mergedByPath.values());
  return {
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function mergeSystemActivities(
  taskActivities: SystemActivity[],
  workspaceActivities: SystemActivity[],
): SystemActivity[] {
  if (taskActivities.length === 0) return workspaceActivities;
  if (workspaceActivities.length === 0) return taskActivities;
  return [...taskActivities, ...workspaceActivities].sort((left, right) => left.timestamp - right.timestamp);
}

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
  const planText = task ? getLatestPlanText(task.messages) : '';
  const workspaceId = task?.workspaceId;
  const workspace = useWorkspaceStore((s) => workspaceId ? s.workspaces.get(workspaceId) : undefined);
  const workspaceActivities = useWorkspaceStore((s) => workspaceId ? s.workspaceActivities.get(workspaceId) ?? EMPTY_SYSTEM_ACTIVITIES : EMPTY_SYSTEM_ACTIVITIES);
  const systemActivities = useMemo(
    () => mergeSystemActivities(task?.systemActivities ?? [], workspaceActivities),
    [task?.systemActivities, workspaceActivities],
  );
  const todoItems = task?.todoItems ?? [];
  const expandedToolCallIds = task?.expandedToolCallIds ?? new Set<string>();
  const scrollToToolCallId = task?.scrollToToolCallId ?? null;
  const clearScrollTarget = useChatStore((s) => s.clearScrollTarget);

  const completionTarget = useWorkspaceCompletion(workspaceId);

  const { containerRef, isAtBottom, scrollToBottom, handleScroll } =
    useAutoScroll([messages.length, messages[messages.length - 1]?.content?.length]);

  // Handle scroll-to-file-edit requests
  useEffect(() => {
    if (!scrollToToolCallId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-tool-call-id="${scrollToToolCallId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    clearScrollTarget();
  }, [scrollToToolCallId, clearScrollTarget, containerRef]);

  // Hide PlanCard if user sent a new message after the plan was generated
  const planIsStale = useMemo(() => {
    if (!task || !planText) return false;
    let lastPlanIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isPlanMessage(messages[i], task.mode)) {
        lastPlanIdx = i;
        break;
      }
    }
    if (lastPlanIdx < 0) return false;
    // Check if any user message exists after the plan
    for (let i = lastPlanIdx + 1; i < messages.length; i++) {
      if (messages[i].role === 'user' && messages[i].type === 'text') return true;
    }
    return false;
  }, [messages, planText, task]);

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        <p className="text-sm tracking-[0.02em]">Ask Flux anything...</p>
      </div>
    );
  }

  const hasVisibleContext = Boolean(task?.currentStatus) || systemActivities.length > 0 || todoItems.length > 0 || isActiveRun;

  if (messages.length === 0 && !hasVisibleContext) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-tertiary">
        <p className="text-sm tracking-[0.02em]">Ask Flux anything...</p>
      </div>
    );
  }

  if (messages.length === 0) {
    const groupedActivities = groupActivitiesByCategory(systemActivities);
    const waitingLabel = todoItems.length > 0
      ? 'Checklist received — waiting for agent output...'
      : 'Waiting for first output...';

    return (
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-6 py-5"
        >
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3">
            {task?.currentStatus && (
              <ActivityIndicator
                label={task.currentStatus}
                active={isActiveRun}
                statusKind={task.currentStatusKind ?? 'diagnostic'}
              />
            )}

            {groupedActivities.length > 0 ? (
              groupedActivities.map((group) => (
                <div key={`empty-state-${group[0].id}`}>
                  {group.length === 1 ? (
                    <SystemActivityInlineItem activity={group[0]} />
                  ) : (
                    <SystemActivityGroup activities={group} />
                  )}
                </div>
              ))
            ) : (
              <div className="px-1 py-1 text-[12px] text-text-tertiary">
                {waitingLabel}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isStreaming = isActiveRun;
  const lastMessage = messages[messages.length - 1];
  const showCursor = isStreaming && lastMessage?.role === 'assistant' && lastMessage?.type === 'text';

  // Build set of message indices where agent switches happened
  const agentSwitchIndices = new Set(agentHistory.map((h) => h.fromMessageIndex));

  // Build maps for merging tool_result into its preceding tool_call.
  // Look past intermediate status messages (e.g. tool.execution_progress) that may
  // sit between a tool_call and its corresponding tool_result.
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

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6 py-5"
      >
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-1">
          <AnimatePresence initial={false}>
            {(() => {
              const rendered: React.ReactNode[] = [];
              let activityCursor = 0;

              // Collect contiguous activities up to a timestamp cutoff,
              // group consecutive same-category runs, and render as
              // individual items or collapsible groups.
              const flushActivities = (cutoff: number) => {
                const batch: typeof systemActivities = [];
                while (activityCursor < systemActivities.length && systemActivities[activityCursor].timestamp <= cutoff) {
                  batch.push(systemActivities[activityCursor]);
                  activityCursor++;
                }
                if (batch.length === 0) return;

                const groups = groupActivitiesByCategory(batch);
                for (const group of groups) {
                  const key = `sys-group-${group[0].id}`;
                  rendered.push(
                    <motion.div
                      key={key}
                      variants={messageVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={messageTransition}
                    >
                      {group.length === 1 ? (
                        <SystemActivityInlineItem activity={group[0]} />
                      ) : (
                        <SystemActivityGroup activities={group} />
                      )}
                    </motion.div>,
                  );
                }
              };

              for (let idx = 0; idx < messages.length; idx++) {
                const msg = messages[idx];
                if (mergedResultIndices.has(idx)) continue;
                if (!planIsStale && isPlanMessage(msg, task.mode)) continue;

                // Flush activities that occurred before this message
                flushActivities(msg.timestamp);

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
                            {switchEntry.agentId === nextAgent.agentId
                              ? <>Set model to <span className="font-medium text-text-secondary">{nextAgent.model}</span></>
                              : <>Switched to {AGENT_LABELS[nextAgent.agentId] ?? nextAgent.agentId}{nextAgent.model ? <> <span className="font-medium text-text-secondary">({nextAgent.model})</span></> : null}</>
                            }
                          </span>
                        </div>
                      </motion.div>,
                    );
                  }
                }

                const mergedResult = mergedResultForCall.get(idx) ?? null;

                const messageEl = taskId && renderMessage(msg, idx, taskId, taskStatus, mergedResult, task.mode, expandedToolCallIds);
                if (!messageEl) continue;

                rendered.push(
                  <motion.div
                    key={msg._seqId ?? `${msg.timestamp}-${idx}`}
                    variants={messageVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={messageTransition}
                  >
                    {messageEl}
                  </motion.div>,
                );
              }

              // Flush any remaining activities after the last message
              flushActivities(Infinity);

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

          {(taskStatus === 'done' || taskStatus === 'error') && (() => {
            const resultMsg = [...messages].reverse().find((m) => m.type === 'result');
            const mergedDiff = mergeDiffEntries(diffs, task.cwd);

            // Show combined completion card with inline files when workspace is available.
            // Show on error too — the agent may have completed work before the error occurred
            // (e.g., session lock errors after changes were committed).
            if (workspace && task.mode === 'act') {
              return (
                <CompletionCard
                  workspace={workspace}
                  suggestedMergeTarget={completionTarget}
                  onContinue={() => {
                    useUiStore.getState().setBottomPanelMode('agent');
                  }}
                  diff={mergedDiff}
                  durationMs={resultMsg?.durationMs}
                />
              );
            }

            // Fallback to TaskFooter for non-workspace tasks
            if (diffs.size > 0 || messages.some((m) => m.type === 'result')) {
              return (
                <TaskFooter
                  durationMs={resultMsg?.durationMs}
                  diff={mergedDiff}
                />
              );
            }
            return null;
          })()}

          {task.mode === 'plan' && taskId && (planText || task.planData) && !planIsStale && (taskStatus === 'done' || isStreaming) && (
            <PlanCard task={task} isStreaming={taskStatus === 'running' && task.mode === 'plan'} />
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
                        className="premium-toolbar-button rounded-full border border-border/60 bg-bg-elevated/50 px-3 py-1.5 text-xs font-medium text-text-secondary"
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
                  title="Dismiss suggestion"
                  aria-label="Dismiss suggestion"
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
          title="Scroll to bottom"
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
      .map((m) => stripFluxTokens(m.content))
      .join('\n\n');
    navigator.clipboard.writeText(planText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-bg-elevated/50 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <ClipboardList size={14} className="text-text-secondary" />
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
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-success text-white hover:bg-success/85 transition-colors flex items-center gap-1.5"
        >
          <Play size={12} />
          Implement Plan
        </button>
      </div>
    </div>
  );
}

function AuthErrorBlock() {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const task = useChatStore.getState().getActiveTask();
  const cwd = task?.cwd ?? process.cwd?.() ?? '/';

  const handleLogin = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await window.api.invoke('shell:exec', {
        command: 'claude /login',
        cwd,
        timeout: 60_000,
      }) as { stdout: string; stderr: string; exitCode: number };
      if (res.exitCode === 0) {
        setResult({ ok: true, message: 'Logged in successfully. You can now send a new message.' });
      } else {
        setResult({ ok: false, message: res.stderr || 'Login command failed. Try running it manually in your terminal.' });
      }
    } catch {
      setResult({ ok: false, message: 'Could not run login command. Try running "claude /login" in your terminal.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-error/30 bg-error/5 p-4 space-y-3">
      <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase bg-error/15 text-error border border-error/20">
        Authentication Required
      </span>
      <p className="text-sm text-text-secondary">
        To resolve, please run <code className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-primary text-xs font-mono">claude /login</code> and then restart Conductor:
      </p>
      <button
        onClick={handleLogin}
        disabled={running}
        className="inline-flex items-center gap-2 rounded-lg border border-border-primary bg-bg-secondary px-3 py-1.5 text-sm text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
      >
        <Play className="w-3 h-3" />
        <code className="font-mono text-xs">claude /login</code>
      </button>
      {result && (
        <p className={`text-xs ${result.ok ? 'text-success' : 'text-error'}`}>
          {result.message}
        </p>
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
  expandedToolCallIds?: Set<string>,
) {
  const isActiveRun = taskStatus === 'running' || taskStatus === 'waiting_approval' || taskStatus === 'waiting_input';
  const highlightAsPlan = isPlanMessage(msg, taskMode as 'plan' | 'act' | undefined);

  switch (msg.type) {
    case 'text': {
      const hasMedia = (msg.images && msg.images.length > 0) || (msg.attachments && msg.attachments.length > 0);
      const displayContent = msg.role === 'assistant' ? stripFluxTokens(msg.content) : msg.content;
      if (!displayContent.trim() && !hasMedia) return null;
      return (
        <div className="my-0.5">
          <MessageBubble
            content={displayContent}
            role={msg.role as 'user' | 'assistant' | 'system'}
            images={msg.images}
            attachments={msg.attachments}
            highlightAsPlan={highlightAsPlan}
          />
        </div>
      );
    }

    case 'lifecycle':
      return (
        <LifecycleCard
          state={msg.lifecycleState ?? 'unknown'}
          label={msg.lifecycleLabel ?? 'Lifecycle event'}
        />
      );

    case 'status':
      if (!msg.content.trim()) return null;
      return (
        <ActivityIndicator
          label={msg.content}
          statusKind={msg.statusKind}
          active={isActiveRun}
        />
      );

    case 'tool_call': {
      // Todo-style tool calls are shown in the sticky TodoBar above input.
      const toolNameLower = (msg.toolName ?? '').toLowerCase();
      const hasStructuredTodoPayload = Boolean(
        msg.toolInput
        && (Array.isArray(msg.toolInput.todos) || Array.isArray(msg.toolInput.plan)),
      );
      if (toolNameLower.includes('todo') || toolNameLower === 'update_plan' || hasStructuredTodoPayload) return null;

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
          forceExpanded={msg.toolCallId ? expandedToolCallIds?.has(msg.toolCallId) : undefined}
        />
      );
    }

    case 'tool_result':
      if (!msg.content.trim()) return null;
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
      if (msg.errorKind === 'auth') {
        return <AuthErrorBlock />;
      }
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

    case 'quality_gate': {
      const isPreExisting = msg.isPreExisting;
      const statusIcon = msg.passed ? '✓' : isPreExisting ? '⚠' : '✗';
      const statusColor = msg.passed
        ? 'text-success'
        : isPreExisting
          ? 'text-warning'
          : 'text-error';
      const output = (msg.stderr || msg.stdout || '').trim();
      return (
        <div className="rounded-lg border border-border/50 bg-bg-surface/50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`font-semibold ${statusColor}`}>{statusIcon}</span>
              <code className="text-xs text-text-secondary">{msg.command}</code>
              {isPreExisting && (
                <span className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-warning/20 text-warning">
                  pre-existing
                </span>
              )}
              {typeof msg.retryAttempt === 'number' && typeof msg.maxRetries === 'number' && (
                <span className="text-[10px] text-text-tertiary">
                  retry {msg.retryAttempt}/{msg.maxRetries}
                </span>
              )}
            </div>
            <span className={`text-xs font-medium ${statusColor}`}>
              {msg.passed ? 'passed' : 'failed'}
            </span>
          </div>
          {output && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-tertiary hover:text-text-secondary select-none">
                Show output ({output.split('\n').length} lines)
              </summary>
              <pre className="mt-1.5 max-h-48 overflow-auto rounded bg-bg-primary/70 p-2 text-[11px] text-text-secondary whitespace-pre-wrap">
                {output}
              </pre>
            </details>
          )}
        </div>
      );
    }

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

    case 'shell_result':
      return (
        <ShellResultBlock
          command={msg.command}
          exitCode={msg.exitCode}
          stdout={msg.stdout}
          stderr={msg.stderr}
          durationMs={msg.durationMs}
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
