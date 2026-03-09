import { useEffect } from 'react';
import { useChatStore } from '../stores/chat';
import type { AgentMessage, DiffData } from '../lib/types';

export function useAgentStream() {
  useEffect(() => {
    const unsubMessage = window.api.on('agent:message', (data: unknown) => {
      const { taskId, message } = data as { taskId: string; message: AgentMessage };
      useChatStore.getState().ingestStreamMessage(taskId, message);
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
      unsubMessage();
      unsubDone();
      unsubPermission();
      unsubDiff();
    };
  }, []);
}
