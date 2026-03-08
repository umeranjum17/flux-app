import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AgentMessage, Task, TaskStatus, AgentId, TaskMode, ThinkingLevel, FileAttachment } from '../lib/types';

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
          return;
        }

        if (task.status !== 'running' && task.status !== 'waiting_approval') {
          task.status = 'running';
        }
      });
    },

    setTaskStatus(taskId, status) {
      set((state) => {
        const task = state.tasks.get(taskId);
        if (!task) return;
        task.status = status;
        if (status === 'done' || status === 'error') {
          task.pendingApproval = undefined;
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
  if (message.type !== 'permission_request' && task.pendingApproval) {
    task.pendingApproval = undefined;
  }
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
  if (task.status !== 'running' && task.status !== 'waiting_approval') {
    task.status = 'running';
  }
}

function shouldMergeStreamChunk(previous: AgentMessage | undefined, incoming: AgentMessage): boolean {
  if (!previous) return false;
  if (incoming.role !== 'assistant') return false;
  if (incoming.type !== 'text' && incoming.type !== 'thinking') return false;
  return previous.role === incoming.role && previous.type === incoming.type;
}
