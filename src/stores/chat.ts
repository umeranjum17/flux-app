import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ActiveRunState,
  AgentMessage,
  AgentId,
  FileAttachment,
  PendingQuestionState,
  Task,
  TaskMode,
  TaskStatus,
  ThinkingLevel,
} from '../lib/types';

interface ChatState {
  tasks: Map<string, Task>;
  activeTaskId: string | null;

  createTask(opts: {
    id: string;
    title: string;
    agentId: AgentId;
    model: string;
    mode: TaskMode;
    thinking: ThinkingLevel;
    cwd: string;
    sessionId?: string;
  }): void;
  removeTask(taskId: string): void;
  setActiveTask(taskId: string | null): void;
  addMessage(taskId: string, message: AgentMessage): void;
  ingestStreamMessage(taskId: string, message: AgentMessage): void;
  setTaskStatus(taskId: string, status: TaskStatus): void;
  setTaskSessionId(taskId: string, sessionId: string): void;
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
  addUserMessage(taskId: string, content: string, images?: string[], attachments?: FileAttachment[]): void;
  getActiveTask(): Task | undefined;
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    tasks: new Map(),
    activeTaskId: null,

    createTask(opts) {
      set((state) => {
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
        });
        state.activeTaskId = opts.id;
      });
    },

    removeTask(taskId) {
      set((state) => {
        state.tasks.delete(taskId);
        if (state.activeTaskId === taskId) {
          const keys = Array.from(state.tasks.keys());
          state.activeTaskId = keys.length > 0 ? keys[keys.length - 1] : null;
        }
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
        appendMessage(task, message);
        promoteTaskStatus(task, message);
      });
    },

    ingestStreamMessage(taskId, message) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        const last = task.messages[task.messages.length - 1];

        if (shouldMergeStreamChunk(last, message)) {
          last.content += message.content;
          last.timestamp = message.timestamp;
        } else {
          appendMessage(task, message);
        }
        applyLiveMessage(task, message);
      });
    },

    setTaskStatus(taskId, status) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.status = status;
        if (status === 'done' || status === 'error' || status === 'idle') {
          task.pendingApproval = undefined;
          task.pendingQuestion = undefined;
          task.activeRun = undefined;
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

    getActiveTask() {
      const { tasks, activeTaskId } = get();
      return activeTaskId ? tasks.get(activeTaskId) : undefined;
    },
  })),
);

function appendMessage(task: Task, message: AgentMessage): void {
  task.messages.push(message);
  if (message.type === 'result') {
    task.costUsd += message.costUsd ?? 0;
    task.inputTokens += message.inputTokens ?? 0;
    task.outputTokens += message.outputTokens ?? 0;
  }
  if (message.type === 'rate_limit') {
    task.rateLimitInfo = message.rateLimitInfo;
  }
  if (message.type === 'quality_gate' && message.command) {
    task.lastQualityGate = {
      status: message.passed ? 'passed' : 'failed',
      command: message.command,
      exitCode: message.exitCode ?? 0,
    };
  }
}

function shouldMergeStreamChunk(previous: AgentMessage | undefined, incoming: AgentMessage): boolean {
  if (!previous) return false;
  if (incoming.role !== 'assistant') return false;
  if (incoming.type !== 'text' && incoming.type !== 'thinking') return false;
  return previous.role === incoming.role && previous.type === incoming.type;
}

function promoteTaskStatus(task: Task, message: AgentMessage): void {
  if (task.status === 'done' || task.status === 'error' || task.status === 'idle') {
    if (message.type !== 'rate_limit') {
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
  if (!task.activeRun) {
    task.activeRun = {
      startedAt: timestamp,
      lastActivityAt: timestamp,
      phase,
    };
  } else {
    task.activeRun.lastActivityAt = timestamp;
    task.activeRun.phase = phase;
  }

  if (phase === 'tool') {
    task.activeRun.activeToolCallId = message?.toolCallId ?? task.activeRun.activeToolCallId;
    task.activeRun.activeToolName = message?.toolName ?? task.activeRun.activeToolName;
    return;
  }

  if (message?.type === 'tool_result' && message.toolCallId && task.activeRun.activeToolCallId === message.toolCallId) {
    task.activeRun.activeToolCallId = undefined;
  }

  if (phase !== 'waiting_approval' && phase !== 'waiting_input') {
    task.activeRun.activeToolCallId = phase === 'responding' ? undefined : task.activeRun.activeToolCallId;
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
