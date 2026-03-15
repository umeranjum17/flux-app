import { useEffect } from 'react';
import { toast } from 'sonner';
import { useChatStore } from '../stores/chat';
import { useUiStore } from '../stores/ui';
import { useWorkspaceStore } from '../stores/workspace';
import type { AgentMessage, DiffData, TodoItem } from '../lib/types';

function shouldAutoApprove(toolName: string): boolean {
  const { autoApprove, autoApproveTools } = useUiStore.getState();
  if (!autoApprove) return false;
  return autoApproveTools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()));
}

export function useAgentStream() {
  useEffect(() => {
    // Buffer messages and flush in batches to avoid per-message re-renders
    let messageBuffer: Array<{ taskId: string; message: AgentMessage }> = [];
    let rafId: number | null = null;

    function flushMessages() {
      rafId = null;
      if (messageBuffer.length === 0) return;
      const batch = messageBuffer;
      messageBuffer = [];
      useChatStore.getState().ingestStreamBatch(batch);
    }

    const unsubMessage = window.api.on('agent:message', (data: unknown) => {
      const { taskId, message } = data as { taskId: string; message: AgentMessage };
      messageBuffer.push({ taskId, message });
      if (rafId === null) {
        rafId = requestAnimationFrame(flushMessages);
      }
    });

    const unsubDone = window.api.on('agent:done', (data: unknown) => {
      // Flush any pending buffered messages before marking task as done
      // to prevent UI showing stale "running" state
      if (messageBuffer.length > 0) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        flushMessages();
      }

      const { taskId, error } = data as { taskId: string; error?: string };
      if (error) {
        useChatStore.getState().addMessage(taskId, {
          type: 'error',
          role: 'system',
          content: error,
          timestamp: Date.now(),
        });
      }
      useChatStore.getState().setTaskStatus(taskId, error ? 'error' : 'done');

      // Auto-open the changes panel after a successful coding turn
      if (!error) {
        const task = useChatStore.getState().tasks.get(taskId);
        if (task?.workspaceId) {
          useWorkspaceStore.getState().openChangesPanel(task.workspaceId);
        }
      }
    });

    const unsubPermission = window.api.on('agent:permission', (data: unknown) => {
      const { taskId, requestId, toolName, description, action, path } = data as any;

      if (shouldAutoApprove(toolName)) {
        toast(`Auto-approved: ${toolName}`, { duration: 2000 });
        useChatStore.getState().setPendingApproval(taskId, null);
        window.api.invoke('task:approve', { taskId, requestId });
        return;
      }

      useChatStore.getState().setPendingApproval(taskId, { requestId, toolName, description, action, path });
    });

    const unsubDiff = window.api.on('agent:diff', (data: unknown) => {
      const { taskId, key, diff } = data as { taskId: string; key: string; diff: DiffData };
      useChatStore.setState((state) => {
        const task = state.tasks.get(taskId);
        if (task) {
          task.diffs.set(key, diff);
        }
      });
    });

    const unsubTodo = window.api.on('agent:todo', (data: unknown) => {
      const { taskId, todoItems } = data as { taskId: string; todoItems: TodoItem[] };
      useChatStore.getState().setTodoItems(taskId, todoItems);
    });

    const unsubTodoUpdate = window.api.on('agent:todo-update', (data: unknown) => {
      const { taskId, stepId, status } = data as { taskId: string; stepId: number; status: TodoItem['status'] };
      useChatStore.getState().updateTodoItem(taskId, stepId, status);
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      flushMessages(); // flush any remaining
      unsubMessage();
      unsubDone();
      unsubPermission();
      unsubDiff();
      unsubTodo();
      unsubTodoUpdate();
    };
  }, []);
}
