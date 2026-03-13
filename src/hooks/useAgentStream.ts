import { useEffect } from 'react';
import { toast } from 'sonner';
import { useChatStore } from '../stores/chat';
import { useUiStore } from '../stores/ui';
import type { AgentMessage, DiffData } from '../lib/types';

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

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      flushMessages(); // flush any remaining
      unsubMessage();
      unsubDone();
      unsubPermission();
      unsubDiff();
    };
  }, []);
}
