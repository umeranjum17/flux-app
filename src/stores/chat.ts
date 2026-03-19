import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ActiveRunState,
  AgentMessage,
  AgentId,
  EditedFileEntry,
  FileAttachment,
  PendingQuestionState,
  SubagentState,
  SystemActivity,
  Task,
  TaskMode,
  TaskStatus,
  ThinkingLevel,
  TodoItem,
} from '../lib/types';
import { useWorkspaceStore } from './workspace';
import { normalizeTrackedFilePath } from '../lib/path-utils';
import { appendSystemActivity } from '../lib/system-activities';

interface ChatState {
  tasks: Map<string, Task>;
  activeTaskId: string | null;
  tabOrder: string[];

  createTask(opts: {
    id: string;
    title: string;
    agentId: AgentId;
    model: string;
    mode: TaskMode;
    thinking: ThinkingLevel;
    cwd: string;
    sessionId?: string;
    workspaceId?: string;
    activate?: boolean;
    contextless?: boolean;
  }): void;
  removeTask(taskId: string): void;
  removeTasksForWorkspace(workspaceId: string): void;
  setActiveTask(taskId: string | null): void;
  closeTab(taskId: string): void;
  reorderTabs(fromIndex: number, toIndex: number): void;
  addMessage(taskId: string, message: AgentMessage): void;
  restoreMessages(taskId: string, messages: AgentMessage[]): void;
  ingestStreamMessage(taskId: string, message: AgentMessage): void;
  ingestStreamBatch(batch: Array<{ taskId: string; message: AgentMessage }>): void;
  setTaskStatus(taskId: string, status: TaskStatus): void;
  setTaskSessionId(taskId: string, sessionId: string): void;
  updateWorkspaceTaskCwd(workspaceId: string, cwd: string): void;
  setPendingApproval(
    taskId: string,
    approval: {
      requestId: string;
      toolName: string;
      description: string;
      action?: string;
      path?: string;
    } | null,
  ): void;
  setPendingQuestion(taskId: string, question: PendingQuestionState | null): void;
  setTaskMode(taskId: string, mode: TaskMode): void;
  setTaskThinking(taskId: string, thinking: ThinkingLevel): void;
  switchTaskAgent(taskId: string, newAgentId: AgentId, newModel: string, options?: { stopActiveRun?: boolean }): void;
  addUserMessage(taskId: string, content: string, images?: string[], attachments?: FileAttachment[]): void;
  setPlanData(taskId: string, planData: import('../lib/types').PlanData): void;
  setTodoItems(taskId: string, items: TodoItem[]): void;
  updateTodoItem(taskId: string, stepId: number, status: TodoItem['status'], label?: string): void;
  setActiveSkills(taskId: string, skills: Array<{ id: string; name: string; description?: string }>): void;
  addSystemActivity(taskId: string, activity: SystemActivity): void;
  upsertTaskShell(opts: {
    id: string;
    title: string;
    agentId: AgentId;
    model: string;
    mode: TaskMode;
    thinking: ThinkingLevel;
    cwd: string;
    sessionId?: string;
    workspaceId?: string;
    activate?: boolean;
    contextless?: boolean;
  }): void;
  scrollToFileEdit(toolCallId: string): boolean;
  clearScrollTarget(): void;
  getActiveTask(): Task | undefined;
}

const MAX_TASKS = 20;

// Monotonic counter for stable message IDs (used as React keys so that
// merging streaming chunks doesn't remount/re-animate elements).
let _nextSeqId = 1;

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    tasks: new Map(),
    activeTaskId: null,
    tabOrder: [],

    createTask(opts) {
      get().upsertTaskShell(opts);
    },

    upsertTaskShell(opts) {
      set((state) => {
        const existingTask = state.tasks.get(opts.id);
        if (!existingTask) {
          // Auto-close oldest idle tabs when exceeding limit
          if (state.tabOrder.length >= MAX_TASKS) {
            const oldest = state.tabOrder.find((id) => {
              const t = state.tasks.get(id);
              return t && (t.status === 'idle' || t.status === 'done' || t.status === 'error') && id !== state.activeTaskId;
            });
            if (oldest) {
              clearTaskResources(state.tasks.get(oldest));
              state.tasks.delete(oldest);
              state.tabOrder = state.tabOrder.filter((id) => id !== oldest);
            }
          }

          state.tabOrder.push(opts.id);
          state.tasks.set(opts.id, {
            id: opts.id,
            title: opts.title,
            agentId: opts.agentId,
            model: opts.model,
            mode: opts.mode,
            thinking: opts.thinking,
            status: 'idle',
            messages: [],
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            cwd: opts.cwd,
            sessionId: opts.sessionId,
            workspaceId: opts.workspaceId,
            contextless: opts.contextless,
            subagents: new Map(),
            agentHistory: [],
            diffs: new Map(),
            editedFiles: new Map(),
            expandedToolCallIds: new Set(),
            scrollToToolCallId: null,
            todoItems: [],
            systemActivities: [],
          });
          if (opts.activate !== false) {
            state.activeTaskId = opts.id;
          }
          return;
        }

        existingTask.title = opts.title;
        existingTask.agentId = opts.agentId;
        existingTask.model = opts.model;
        existingTask.mode = opts.mode;
        existingTask.thinking = opts.thinking;
        existingTask.cwd = opts.cwd;
        if (opts.sessionId !== undefined) {
          existingTask.sessionId = opts.sessionId;
        }
        if (opts.workspaceId !== undefined) {
          existingTask.workspaceId = opts.workspaceId;
        }
        if (!state.tabOrder.includes(opts.id)) {
          state.tabOrder.push(opts.id);
        }
        if (opts.activate !== false) {
          state.activeTaskId = opts.id;
        }
      });
    },

    removeTask(taskId) {
      set((state) => {
        removeTaskFromState(state, taskId);
      });
    },

    removeTasksForWorkspace(workspaceId) {
      set((state) => {
        const taskIds = Array.from(state.tasks.values())
          .filter((task) => task.workspaceId === workspaceId)
          .map((task) => task.id)
          .sort((left, right) => state.tabOrder.indexOf(left) - state.tabOrder.indexOf(right));

        for (const taskId of taskIds) {
          removeTaskFromState(state, taskId);
        }
      });
    },

    closeTab(taskId) {
      const handle = get().tasks.get(taskId);
      if (handle && (handle.status === 'running' || handle.status === 'waiting_approval' || handle.status === 'waiting_input')) {
        window.api?.invoke('task:stop', { taskId }).catch(() => {});
      }
      set((state) => {
        removeTaskFromState(state, taskId);
      });
    },

    reorderTabs(fromIndex, toIndex) {
      set((state) => {
        const order = [...state.tabOrder];
        const [moved] = order.splice(fromIndex, 1);
        order.splice(toIndex, 0, moved);
        state.tabOrder = order;
      });
    },

    setActiveTask(taskId) {
      set((state) => {
        state.activeTaskId = taskId;
      });
    },

    addMessage(taskId, message) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        if (message.subagentId) {
          appendSubagentMessage(task, message);
          return;
        }
        appendMessage(task, message);
        if (message.type === 'rate_limit') {
          applyRateLimitMessage(task, message);
        }
        applyLiveMessage(task, message);
        promoteTaskStatus(task, message);
      });
    },

    restoreMessages(taskId, messages) {
      if (messages.length === 0) return;
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;

        for (const message of messages) {
          if (message.subagentId) {
            appendSubagentMessage(task, message, false);
            continue;
          }

          if (message.type === 'status' || message.type === 'rate_limit') {
            continue;
          }

          // If the persisted message was a replacement (authoritative full event),
          // overwrite the target's content instead of appending.
          if (message.replaceLastContent) {
            const replaceTarget = findStreamMergeTarget(task.messages, message);
            if (replaceTarget) {
              replaceTarget.content = message.content;
              replaceTarget.timestamp = message.timestamp;
              trackEditedFile(task, message);
              continue;
            }
          }

          // Merge text/thinking chunks that were persisted as separate rows
          // during streaming (e.g. Copilot delta flushes that interleave
          // text and thinking). Uses backward search so interleaved rows
          // merge into the correct target instead of accumulating.
          const mergeTarget = findStreamMergeTarget(task.messages, message);
          if (mergeTarget) {
            mergeTarget.content += message.content;
            mergeTarget.timestamp = message.timestamp;
          } else {
            appendMessage(task, message);
          }
          trackEditedFile(task, message);
        }
      });
    },

    ingestStreamMessage(taskId, message) {
      set((state) => {
        ingestOne(state, taskId, message);
      });
    },

    ingestStreamBatch(batch) {
      if (batch.length === 0) return;
      set((state) => {
        for (const { taskId, message } of batch) {
          ingestOne(state, taskId, message);
        }
      });
    },

    setTaskStatus(taskId, status) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.status = status;
        if (status === 'done' || status === 'error' || status === 'idle') {
          if (status === 'done') {
            completeTodoItems(task);
          }
          task.pendingApproval = undefined;
          task.pendingQuestion = undefined;
          task.activeRun = undefined;
          task.rateLimitSuggestion = undefined;
          return;
        }

        if (status === 'waiting_approval') {
          ensureActiveRun(task, 'waiting_approval');
          return;
        }

        if (status === 'waiting_input') {
          ensureActiveRun(task, 'waiting_input');
          return;
        }

        if (status === 'running') {
          ensureActiveRun(task, task.activeRun?.phase === 'waiting_input' || task.activeRun?.phase === 'waiting_approval'
            ? 'progress'
            : task.activeRun?.phase ?? 'starting');
        }
      });
    },

    setTaskSessionId(taskId, sessionId) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.sessionId = sessionId;
      });
    },

    updateWorkspaceTaskCwd(workspaceId, cwd) {
      set((state) => {
        for (const task of state.tasks.values()) {
          if (task.workspaceId === workspaceId) {
            task.cwd = cwd;
          }
        }
      });
    },

    setPendingApproval(taskId, approval) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.pendingApproval = approval ?? undefined;
        task.status = approval ? 'waiting_approval' : 'running';
        if (approval) {
          ensureActiveRun(task, 'waiting_approval');
        } else {
          ensureActiveRun(task, 'progress');
        }
      });
    },

    setPendingQuestion(taskId, question) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.pendingQuestion = question ?? undefined;
        task.status = question ? 'waiting_input' : 'running';
        if (question) {
          ensureActiveRun(task, 'waiting_input');
        } else {
          ensureActiveRun(task, 'progress');
        }
      });
    },

    setTaskMode(taskId, mode) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.mode = mode;
      });
    },

    setTaskThinking(taskId, thinking) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.thinking = thinking;
      });
    },

    switchTaskAgent(taskId, newAgentId, newModel, options) {
      const task = get().tasks.get(taskId);
      const shouldStopActiveRun = options?.stopActiveRun !== false;
      if (
        shouldStopActiveRun
        && task
        && (task.status === 'running' || task.status === 'waiting_approval' || task.status === 'waiting_input')
      ) {
        window.api?.invoke('task:stop', { taskId }).catch(() => {});
      }
      set((state) => {
        const t = state.tasks.get(taskId);
        if (!t) return;
        t.agentHistory.push({
          agentId: t.agentId,
          model: t.model,
          fromMessageIndex: t.messages.length,
        });
        t.agentId = newAgentId;
        t.model = newModel;
        t.status = 'idle';
        t.activeRun = undefined;
        t.pendingApproval = undefined;
        t.pendingQuestion = undefined;
        t.rateLimitSuggestion = undefined;
      });
      // Persist agent/model change back to the workspace so it sticks across tab switches
      if (task?.workspaceId) {
        useWorkspaceStore.getState().updateWorkspace(task.workspaceId, {
          agentId: newAgentId,
          model: newModel,
        });
        window.api?.invoke('workspace:update', {
          workspaceId: task.workspaceId,
          agentId: newAgentId,
          model: newModel,
        }).catch(() => {});
      }
    },

    addUserMessage(taskId, content, images?, attachments?) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.messages.push({
          type: 'text',
          role: 'user',
          content,
          timestamp: Date.now(),
          ...(images?.length ? { images } : {}),
          ...(attachments?.length ? { attachments } : {}),
        });
      });
    },

    setPlanData(taskId, planData) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (task) task.planData = planData;
      });
    },

    setTodoItems(taskId, items) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (task) task.todoItems = items;
      });
    },

    updateTodoItem(taskId, stepId, status, label?) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        if (!task.todoItems) {
          task.todoItems = [];
        }
        const item = task.todoItems.find((t) => t.id === stepId);
        if (item) {
          item.status = status;
          if (label) item.label = label;
          return;
        }
        task.todoItems.push({
          id: stepId,
          label: label ?? `Step ${stepId}`,
          status,
        });
        task.todoItems.sort((left, right) => left.id - right.id);
      });
    },

    setActiveSkills(taskId, skills) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.activeSkills = skills;
      });
    },

    addSystemActivity(taskId, activity) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        appendSystemActivity(task.systemActivities, activity);
      });
    },

    scrollToFileEdit(toolCallId) {
      let canScroll = false;
      set((state) => {
        const task = state.activeTaskId ? state.tasks.get(state.activeTaskId) : undefined;
        if (!task) return;

        const mainMatch = task.messages.some(
          (msg) => msg.type === 'tool_call' && msg.toolCallId === toolCallId,
        );
        const subagentMatch = Array.from(task.subagents.values()).some((subagent) =>
          subagent.messages.some(
            (msg) => msg.type === 'tool_call' && msg.toolCallId === toolCallId,
          ),
        );

        canScroll = mainMatch || subagentMatch;
        if (!canScroll) return;

        task.expandedToolCallIds.add(toolCallId);
        task.scrollToToolCallId = toolCallId;
      });
      return canScroll;
    },

    clearScrollTarget() {
      set((state) => {
        const task = state.activeTaskId ? state.tasks.get(state.activeTaskId) : undefined;
        if (!task) return;
        task.scrollToToolCallId = null;
      });
    },

    getActiveTask() {
      const { tasks, activeTaskId } = get();
      return activeTaskId ? tasks.get(activeTaskId) : undefined;
    },
  })),
);

function clearTaskResources(task: Task | undefined): void {
  if (!task) return;
  task.subagents.clear();
  task.diffs.clear();
  task.editedFiles.clear();
  task.expandedToolCallIds.clear();
}

function removeTaskFromState(
  state: {
    tasks: Map<string, Task>;
    activeTaskId: string | null;
    tabOrder: string[];
  },
  taskId: string,
): void {
  const tabIdx = state.tabOrder.indexOf(taskId);
  clearTaskResources(state.tasks.get(taskId));
  state.tasks.delete(taskId);
  state.tabOrder = state.tabOrder.filter((id) => id !== taskId);
  if (state.activeTaskId === taskId) {
    const adjacentIdx = Math.min(tabIdx, state.tabOrder.length - 1);
    state.activeTaskId = state.tabOrder.length > 0 ? state.tabOrder[Math.max(adjacentIdx, 0)] : null;
  }
}

function isFileEditTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.includes('edit') || name.includes('write') || name.includes('patch');
}

function countDiffStatsFromMessage(message: AgentMessage): { additions: number; deletions: number } {
  const diffSource = message.diff ?? '';
  let additions = 0;
  let deletions = 0;
  for (const line of diffSource.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

function trackEditedFile(task: Task, message: AgentMessage): void {
  if (message.type !== 'tool_call') return;
  const toolName = message.toolName ?? '';
  if (!isFileEditTool(toolName)) return;

  const rawFilePath =
    message.filePath ??
    (message.toolInput?.file_path as string | undefined) ??
    (message.toolInput?.path as string | undefined);
  if (!rawFilePath) return;

  const filePath = normalizeTrackedFilePath(rawFilePath, task.cwd);

  const stats = countDiffStatsFromMessage(message);
  const resolvedToolCallId = message.toolCallId ?? `edit-${message.timestamp}`;
  if (!message.toolCallId) {
    message.toolCallId = resolvedToolCallId;
  }
  const existing = task.editedFiles.get(filePath);
  task.editedFiles.set(filePath, {
    filePath,
    toolCallId: resolvedToolCallId,
    additions: (existing?.additions ?? 0) + stats.additions,
    deletions: (existing?.deletions ?? 0) + stats.deletions,
    timestamp: message.timestamp,
  });
}

function ingestOne(state: { tasks: Map<string, Task> }, taskId: string, message: AgentMessage): void {
  const task = state.tasks.get(taskId);
  if (!task) return;
  if (message.subagentId) {
    appendSubagentMessage(task, message, true);
    if (message.subagentStatus === 'spawning' || (!message.subagentStatus && message.type !== 'rate_limit')) {
      task.status = 'running';
    }
    return;
  }

  // Status messages (heartbeats) update a dedicated field instead of growing the array
  if (message.type === 'status') {
    applyStatusMessage(task, message);
    return;
  }

  // Rate limit messages update metadata without accumulating in the array
  if (message.type === 'rate_limit') {
    applyRateLimitMessage(task, message);
    return;
  }

  // Merge duplicate result messages (e.g. Copilot sends both a `result` event
  // and a separate `assistant.usage` event — without merging, tokens and cost
  // would be double-counted and the completion card would flash).
  if (message.type === 'result') {
    const existingIdx = findLastResultIndex(task.messages);
    if (existingIdx >= 0) {
      const existing = task.messages[existingIdx];
      if (message.costUsd != null && existing.costUsd == null) {
        existing.costUsd = message.costUsd;
        task.costUsd += message.costUsd;
      }
      if (message.durationMs != null && !existing.durationMs) {
        existing.durationMs = message.durationMs;
      }
      // Don't double-count tokens — the first result already contributed
      applyLiveMessage(task, message);
      return;
    }
  }

  // Deduplicate tool_result entries for the same toolCallId. Some agents (e.g.
  // Copilot) send partial results followed by a final result — replace the
  // earlier entry instead of accumulating separate messages.
  if (message.type === 'tool_result' && message.toolCallId) {
    for (let i = task.messages.length - 1; i >= 0; i--) {
      const prev = task.messages[i];
      if (prev.type === 'tool_result' && prev.toolCallId === message.toolCallId) {
        prev.content = message.content;
        prev.timestamp = message.timestamp;
        prev.isError = message.isError;
        applyLiveMessage(task, message);
        return;
      }
    }
  }

  // If the message carries authoritative content that should replace the
  // delta-accumulated text (e.g. Copilot full events with correct spacing),
  // find the merge target and overwrite instead of appending.
  if (message.replaceLastContent) {
    const replaceTarget = findStreamMergeTarget(task.messages, message);
    if (replaceTarget) {
      replaceTarget.content = message.content;
      replaceTarget.timestamp = message.timestamp;
      promoteTaskStatus(task, message);
      return;
    }
    // No target found — fall through to normal append
  }

  // Search backwards for a merge target of the same type within the current
  // assistant turn. This handles interleaved text/thinking from agents like
  // Copilot where flushDeltas emits both buffers in the same cycle — without
  // this, each cycle would append new messages instead of merging.
  const mergeTarget = findStreamMergeTarget(task.messages, message);
  if (mergeTarget) {
    mergeTarget.content += message.content;
    mergeTarget.timestamp = message.timestamp;
  } else {
    appendMessage(task, message);
  }

  // Track edited files in real-time
  trackEditedFile(task, message);

  // When a text/thinking chunk was merged into the previous message, the run
  // phase hasn't changed (still 'responding' or 'thinking').  Skip the full
  // applyLiveMessage path to avoid unnecessary activeRun.lastActivityAt
  // mutations — those dirty the Zustand state on every 32 ms delta flush,
  // causing cascading re-renders in LiveRunHeader and MessageList.
  if (mergeTarget) {
    promoteTaskStatus(task, message);
  } else {
    applyLiveMessage(task, message);
  }
}

function findLastResultIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'result') return i;
  }
  return -1;
}

function appendMessage(task: Task, message: AgentMessage): void {
  if (!message._seqId) message._seqId = _nextSeqId++;
  task.messages.push(message);
  if (message.type === 'result') {
    task.costUsd += message.costUsd ?? 0;
    task.inputTokens += message.inputTokens ?? 0;
    task.outputTokens += message.outputTokens ?? 0;
  }
  if (message.type === 'quality_gate' && message.command) {
    task.lastQualityGate = {
      status: message.passed ? 'passed' : 'failed',
      command: message.command,
      exitCode: message.exitCode ?? 0,
    };
  }
}

function applyStatusMessage(task: Task, message: AgentMessage): void {
  task.currentStatus = message.content;
  task.currentStatusKind = message.statusKind;
  applyLiveMessage(task, message);
}

function applyRateLimitMessage(task: Task, message: AgentMessage): void {
  task.rateLimitInfo = message.rateLimitInfo;
  const info = message.rateLimitInfo as Record<string, any> | undefined;
  if (info?.status === 'rejected') {
    const allAgents: AgentId[] = ['claude-code', 'codex', 'gemini', 'openai', 'ollama'];
    task.rateLimitSuggestion = {
      agents: allAgents.filter((a) => a !== task.agentId),
    };
  }
  applyLiveMessage(task, message);
}

function appendSubagentMessage(task: Task, message: AgentMessage, mergeStream = false): void {
  const subagentId = message.subagentId;
  if (!subagentId) return;

  const subagent = ensureSubagent(task, subagentId, message.subagentName);

  if (message.subagentStatus === 'spawning' || message.subagentStatus === 'done' || message.subagentStatus === 'error') {
    subagent.status = message.subagentStatus;
    syncSubagentStats(subagent, message);
    task.messages.push(message);
    return;
  }

  subagent.status = 'running';
  syncSubagentStats(subagent, message);

  const last = subagent.messages[subagent.messages.length - 1];
  if (mergeStream && shouldMergeStreamChunk(last, message)) {
    last.content += message.content;
    last.timestamp = message.timestamp;
  } else {
    subagent.messages.push(message);
  }
}

function ensureSubagent(task: Task, subagentId: string, name?: string): SubagentState {
  let subagent = task.subagents.get(subagentId);
  if (!subagent) {
    subagent = {
      name: name ?? 'Subagent',
      status: 'spawning',
      messages: [],
      toolCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    task.subagents.set(subagentId, subagent);
  } else if (name) {
    subagent.name = name;
  }
  return subagent;
}

function syncSubagentStats(subagent: SubagentState, message: AgentMessage): void {
  if (typeof message.subagentToolCount === 'number') {
    subagent.toolCount = message.subagentToolCount;
  } else if (message.type === 'tool_call') {
    subagent.toolCount += 1;
  }

  if (message.subagentTokens) {
    subagent.inputTokens = message.subagentTokens.input;
    subagent.outputTokens = message.subagentTokens.output;
    return;
  }

  if (message.type === 'result') {
    subagent.inputTokens += message.inputTokens ?? 0;
    subagent.outputTokens += message.outputTokens ?? 0;
  }
}

function shouldMergeStreamChunk(previous: AgentMessage | undefined, incoming: AgentMessage): boolean {
  if (!previous) return false;
  if (incoming.role !== 'assistant') return false;
  if (incoming.type !== 'text' && incoming.type !== 'thinking') return false;
  return previous.role === incoming.role && previous.type === incoming.type;
}

/**
 * Search backwards from the end of the message list for a merge target that
 * matches the incoming message's type and role. Only looks past other
 * text/thinking assistant messages — stops at any structural boundary
 * (tool_call, tool_result, user message, etc.) to avoid merging across turns.
 */
function findStreamMergeTarget(messages: AgentMessage[], incoming: AgentMessage): AgentMessage | undefined {
  if (incoming.role !== 'assistant') return undefined;
  if (incoming.type !== 'text' && incoming.type !== 'thinking') return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.type === incoming.type) {
      return msg;
    }
    // Stop at non-streaming boundaries — don't merge across turns
    if (msg.role !== 'assistant' || (msg.type !== 'text' && msg.type !== 'thinking')) {
      break;
    }
  }
  return undefined;
}

function promoteTaskStatus(task: Task, message: AgentMessage): void {
  if (task.status === 'done' || task.status === 'error' || task.status === 'idle') {
    if (message.type !== 'rate_limit' && message.type !== 'status' && message.type !== 'result') {
      task.status = 'running';
    }
    return;
  }

  if (task.status === 'waiting_approval' || task.status === 'waiting_input' || task.status === 'running') {
    return;
  }

  if (message.type !== 'rate_limit') {
    task.status = 'running';
  }
}

function applyLiveMessage(task: Task, message: AgentMessage): void {
  // Status messages (heartbeats, progress updates) should not resurrect a finished task
  if (message.type === 'status' && (task.status === 'done' || task.status === 'error')) {
    return;
  }

  // Result message means the agent completed its work. Transition to done
  // immediately as a safety net — the agent:done IPC event may be delayed
  // or never arrive if the SDK's async iterator cleanup hangs.
  if (message.type === 'result') {
    completeTodoItems(task);
    task.status = 'done';
    task.currentStatus = undefined;
    task.currentStatusKind = undefined;
    task.pendingApproval = undefined;
    task.activeRun = undefined;
    return;
  }

  const nextPhase = getRunPhaseForMessage(message);
  if (nextPhase) {
    ensureActiveRun(task, nextPhase, message);
  }

  if (message.type === 'permission_request') {
    task.pendingApproval = {
      requestId: message.requestId ?? message.toolCallId ?? `approval-${message.timestamp}`,
      toolName: message.toolName ?? 'unknown',
      description: message.content,
      action: message.action,
      path: message.filePath,
    };
    task.status = 'waiting_approval';
  } else if (message.type === 'question_request') {
    task.pendingQuestion = {
      requestId: message.requestId ?? `question-${message.timestamp}`,
      prompt: message.content,
      questions: message.questions ?? [],
      options: message.options,
      allowFreeform: message.allowFreeform ?? true,
      placeholder: message.placeholder,
    };
    task.status = 'waiting_input';
  } else if (message.role === 'user' && task.pendingQuestion) {
    task.pendingQuestion = undefined;
    if (task.status === 'waiting_input') {
      task.status = 'running';
    }
    ensureActiveRun(task, 'progress', message);
  } else if (message.type !== 'rate_limit' && message.type !== 'status' && task.pendingQuestion) {
    task.pendingQuestion = undefined;
  }

  if (message.type !== 'permission_request' && task.pendingApproval) {
    task.pendingApproval = undefined;
  }

  if (message.type !== 'rate_limit' && message.type !== 'permission_request' && message.type !== 'question_request') {
    if (task.status !== 'waiting_approval' && task.status !== 'waiting_input') {
      task.status = 'running';
    }
  }
}

function ensureActiveRun(task: Task, phase: ActiveRunState['phase'], message?: AgentMessage): void {
  const timestamp = message?.timestamp ?? Date.now();
  // Heartbeat progress messages should update phase but NOT reset lastActivityAt,
  // so that the stalled detection can still trigger during long API waits.
  const isHeartbeat = message?.type === 'status' && message.statusKind === 'progress';
  if (!task.activeRun) {
    task.activeRun = {
      startedAt: timestamp,
      lastActivityAt: timestamp,
      phase,
    };
  } else {
    if (!isHeartbeat) {
      task.activeRun.lastActivityAt = timestamp;
    }
    task.activeRun.phase = phase;
  }

  if (phase === 'tool') {
    task.activeRun.activeToolCallId = message?.toolCallId ?? task.activeRun.activeToolCallId;
    task.activeRun.activeToolName = message?.toolName ?? task.activeRun.activeToolName;
    return;
  }

  if (message?.type === 'tool_result' && message.toolCallId && task.activeRun.activeToolCallId === message.toolCallId) {
    task.activeRun.activeToolCallId = undefined;
    task.activeRun.activeToolName = undefined;
  }

  if (phase !== 'waiting_approval' && phase !== 'waiting_input') {
    task.activeRun.activeToolCallId = phase === 'responding' ? undefined : task.activeRun.activeToolCallId;
  }
}

function completeTodoItems(task: Task): void {
  if (!task.todoItems || task.todoItems.length === 0) return;
  for (const item of task.todoItems) {
    item.status = 'done';
  }
}

function getRunPhaseForMessage(message: AgentMessage): ActiveRunState['phase'] | null {
  if (message.type === 'permission_request') return 'waiting_approval';
  if (message.type === 'question_request') return 'waiting_input';
  if (message.type === 'tool_call' || message.type === 'tool_result') return 'tool';
  if (message.type === 'thinking') return 'thinking';
  if (message.type === 'text' && message.role === 'assistant') return 'responding';
  if (message.type === 'status') {
    if (message.statusKind === 'spawn' || message.statusKind === 'startup') return 'starting';
    return 'progress';
  }
  if (message.type === 'result' || message.type === 'quality_gate') return 'responding';
  return null;
}
