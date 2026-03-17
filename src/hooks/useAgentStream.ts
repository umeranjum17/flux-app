import { useEffect } from 'react';
import { toast } from 'sonner';
import { useChatStore } from '../stores/chat';
import { useUiStore } from '../stores/ui';
import { useWorkspaceStore } from '../stores/workspace';
import type { Checkpoint, IpcActivity, RepoMapIpcStatus, WorkspaceOperation, WorkspaceOutcome, WorkspaceStatus } from '../lib/ipc-api';
import type { AgentMessage, DiffData, SystemActivity, TodoItem } from '../lib/types';
import { shouldRenderIpcActivity, toSystemActivity } from '../lib/ipc-activity';
import { normalizeTrackedFilePath } from '../lib/path-utils';
import { workspaceOutcomeConfig } from '../lib/workspace-status';

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

    // Track whether we've already auto-opened the file activity panel for this run
    const autoOpenedForTask = new Set<string>();
    const lastWorkspaceStatus = new Map<string, WorkspaceStatus>();
    const lastWorkspaceOutcome = new Map<string, WorkspaceOutcome>();
    let lastRepoMapState: RepoMapIpcStatus['state'] | null = null;

    const unsubMessage = window.api.on('agent:message', (data: unknown) => {
      const { taskId, message } = data as { taskId: string; message: AgentMessage };
      messageBuffer.push({ taskId, message });

      // Auto-open file activity panel on first file edit (only for the active task)
      if (
        message.type === 'tool_call' &&
        message.toolName &&
        !autoOpenedForTask.has(taskId)
      ) {
        const toolLower = message.toolName.toLowerCase();
        if (toolLower.includes('edit') || toolLower.includes('write') || toolLower.includes('patch')) {
          const filePath = message.filePath ?? (message.toolInput?.file_path as string | undefined) ?? (message.toolInput?.path as string | undefined);
          if (filePath) {
            const chatState = useChatStore.getState();
            if (chatState.activeTaskId === taskId) {
              autoOpenedForTask.add(taskId);
              const task = chatState.tasks.get(taskId);
              const contextKey = task?.workspaceId ?? taskId;
              useUiStore.getState().openWorkspacePanelTab('activity');
            }
          }
        }
      }

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

      const { taskId, error, errorKind } = data as { taskId: string; error?: string; errorKind?: string };
      if (error) {
        useChatStore.getState().addMessage(taskId, {
          type: 'error',
          role: 'system',
          content: error,
          timestamp: Date.now(),
          ...(errorKind ? { errorKind: errorKind as AgentMessage['errorKind'] } : {}),
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
          for (const [index, file] of diff.files.entries()) {
            const normalizedPath = normalizeTrackedFilePath(file.path, task.cwd);
            const existing = task.editedFiles.get(normalizedPath);
            task.editedFiles.set(normalizedPath, {
              filePath: normalizedPath,
              toolCallId: existing?.toolCallId ?? `diff-${key}-${index}`,
              additions: file.additions,
              deletions: file.deletions,
              timestamp: Date.now(),
            });
          }
        }
      });
    });

    const unsubTodo = window.api.on('agent:todo', (data: unknown) => {
      const { taskId, todoItems } = data as { taskId: string; todoItems: TodoItem[] };
      const store = useChatStore.getState();
      store.setTodoItems(taskId, todoItems);
      const summary = todoItems.map((t) => t.label).join(', ');
      store.addSystemActivity(taskId, makeActivity('skill', 'Progress tracking started', summary));
    });

    const unsubPlan = window.api.on('agent:plan', (data: unknown) => {
      const { taskId, planData } = data as { taskId: string; planData: import('../lib/types').PlanData };
      useChatStore.getState().setPlanData(taskId, planData);
    });

    const unsubTodoUpdate = window.api.on('agent:todo-update', (data: unknown) => {
      const { taskId, stepId, status, label } = data as { taskId: string; stepId: number; status: TodoItem['status']; label?: string };
      const store = useChatStore.getState();
      store.updateTodoItem(taskId, stepId, status, label);
      const displayLabel = label ?? `Step ${stepId}`;
      const statusIcon = status === 'done' ? 'completed' : status === 'in_progress' ? 'started' : 'pending';
      store.addSystemActivity(taskId, makeActivity('skill', `Step ${statusIcon}`, displayLabel));
    });

    const unsubSkills = window.api.on('agent:skills', (data: unknown) => {
      const { taskId, skills } = data as { taskId: string; skills: Array<{ id: string; name: string; description?: string }> };
      if (skills.length > 0) {
        const store = useChatStore.getState();
        store.setActiveSkills(taskId, skills);
        const names = skills.map((s) => s.name).join(', ');
        store.addSystemActivity(taskId, makeActivity('skill', 'Skills loaded', names));
      }
    });

    const unsubStall = window.api.on('agent:stall', (data: unknown) => {
      const { taskId, stallInfo } = data as {
        taskId: string;
        stallInfo: { type: string; toolName?: string; durationMs: number; autoRestartsRemaining: number };
      };
      useChatStore.getState().addSystemActivity(taskId, buildStallActivity(stallInfo));
    });

    const unsubWorkspaceStatus = window.api.on('workspace:status', (data: unknown) => {
      const { workspaceId, status } = data as { workspaceId: string; status: WorkspaceStatus };
      if (lastWorkspaceStatus.get(workspaceId) === status) {
        return;
      }
      lastWorkspaceStatus.set(workspaceId, status);
      useWorkspaceStore.getState().addWorkspaceActivity(
        workspaceId,
        buildWorkspaceStatusActivity(status),
      );
    });

    const unsubWorkspaceOutcome = window.api.on('workspace:outcome', (data: unknown) => {
      const { workspaceId, outcome } = data as { workspaceId: string; outcome: WorkspaceOutcome };
      if (lastWorkspaceOutcome.get(workspaceId) === outcome) {
        return;
      }
      lastWorkspaceOutcome.set(workspaceId, outcome);
      useWorkspaceStore.getState().addWorkspaceActivity(
        workspaceId,
        buildWorkspaceOutcomeActivity(outcome),
      );
    });

    const unsubCheckpoint = window.api.on('workspace:checkpoint', (data: unknown) => {
      const { workspaceId, checkpoint } = data as { workspaceId: string; checkpoint: Checkpoint };
      useWorkspaceStore.getState().addWorkspaceActivity(
        workspaceId,
        buildCheckpointActivity(checkpoint),
      );
    });

    const unsubWorkspaceUpdated = window.api.on('workspace:updated', (data: unknown) => {
      const { workspaceId, branch, name } = data as { workspaceId: string; branch: string; name: string };
      useWorkspaceStore.getState().addWorkspaceActivity(
        workspaceId,
        makeActivity('workspace', 'Workspace updated', `${name} on ${branch}`),
      );
    });

    const lastWorkspaceOperation = new Map<string, string>();
    const unsubWorkspaceOperation = window.api.on('workspace:operation', (data: unknown) => {
      const operation = data as WorkspaceOperation;
      const nextKey = `${operation.status}:${operation.stage}:${operation.message}:${operation.error ?? ''}`;
      if (lastWorkspaceOperation.get(operation.id) === nextKey) {
        return;
      }
      lastWorkspaceOperation.set(operation.id, nextKey);
      useWorkspaceStore.getState().addWorkspaceActivity(
        operation.workspaceId,
        buildWorkspaceOperationActivity(operation),
      );
    });

    const unsubRepoMapStatus = window.api.on('repomap:status', (data: unknown) => {
      const status = data as RepoMapIpcStatus;
      if (status.state === lastRepoMapState) {
        return;
      }
      lastRepoMapState = status.state;

      const activeTaskId = useChatStore.getState().activeTaskId;
      if (!activeTaskId) {
        return;
      }

      useChatStore.getState().addSystemActivity(activeTaskId, buildRepoMapActivity(status));
    });

    // IPC activity events are too noisy for end-user UI — skip them entirely.
    const unsubIpcActivity = window.api.on('ipc:activity', () => {});

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      flushMessages(); // flush any remaining
      unsubMessage();
      unsubDone();
      unsubPermission();
      unsubDiff();
      unsubTodo();
      unsubPlan();
      unsubTodoUpdate();
      unsubSkills();
      unsubStall();
      unsubWorkspaceStatus();
      unsubWorkspaceOutcome();
      unsubCheckpoint();
      unsubWorkspaceUpdated();
      unsubWorkspaceOperation();
      unsubRepoMapStatus();
      unsubIpcActivity();
    };
  }, []);
}

function makeActivity(
  category: SystemActivity['category'],
  label: string,
  detail?: string,
): SystemActivity {
  return {
    id: `${category}:${label}:${detail ?? ''}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    category,
    label,
    detail,
    timestamp: Date.now(),
  };
}

function buildStallActivity(stallInfo: {
  type: string;
  toolName?: string;
  durationMs: number;
  autoRestartsRemaining: number;
}): SystemActivity {
  const stallSeconds = Math.max(1, Math.round(stallInfo.durationMs / 1000));
  const label = stallInfo.type === 'tool_timeout'
    ? `${stallInfo.toolName ?? 'Tool'} timed out`
    : 'Agent stalled';
  const retryDetail = stallInfo.autoRestartsRemaining > 0
    ? `${stallInfo.autoRestartsRemaining} auto-restart${stallInfo.autoRestartsRemaining === 1 ? '' : 's'} remaining`
    : 'No automatic retries remaining';
  return makeActivity('stall', label, `No activity for ${stallSeconds}s · ${retryDetail}`);
}

function buildWorkspaceStatusActivity(status: WorkspaceStatus): SystemActivity {
  return makeActivity('workspace', `Workspace is ${formatWorkspaceStatus(status)}`);
}

function buildWorkspaceOutcomeActivity(outcome: WorkspaceOutcome): SystemActivity {
  return makeActivity('workspace', 'Workspace outcome updated', workspaceOutcomeConfig[outcome].label);
}

function buildCheckpointActivity(checkpoint: Checkpoint): SystemActivity {
  const summaryParts = [
    `${checkpoint.filesChanged} ${checkpoint.filesChanged === 1 ? 'file' : 'files'}`,
    checkpoint.additions || checkpoint.deletions
      ? `+${checkpoint.additions} / -${checkpoint.deletions}`
      : null,
  ].filter(Boolean);
  return makeActivity(
    'checkpoint',
    checkpoint.description || 'Checkpoint saved',
    summaryParts.join(' · '),
  );
}

function buildWorkspaceOperationActivity(operation: WorkspaceOperation): SystemActivity {
  if (operation.status === 'failed') {
    return makeActivity('workspace', 'Archive failed', operation.error ?? operation.message);
  }
  if (operation.status === 'cancelled') {
    return makeActivity('workspace', 'Archive cancelled', operation.message);
  }
  if (operation.status === 'completed') {
    return makeActivity('workspace', 'Archive complete');
  }
  return makeActivity('workspace', 'Archive in progress', operation.message);
}

function buildRepoMapActivity(status: RepoMapIpcStatus): SystemActivity {
  switch (status.state) {
    case 'building':
      return makeActivity(
        'repomap',
        'Repo map indexing started',
        `${status.parsedFiles}/${status.totalFiles} files parsed`,
      );
    case 'ready':
      return makeActivity(
        'repomap',
        'Repo map ready',
        `${status.totalFiles} files · ${status.totalTags} tags indexed`,
      );
    case 'error':
      return makeActivity(
        'repomap',
        'Repo map failed',
        status.errorMessage || 'Indexer reported an error',
      );
    case 'idle':
    default:
      return makeActivity('sync', 'Repo map idle');
  }
}

function formatWorkspaceStatus(status: WorkspaceStatus): string {
  return status.replace(/_/g, ' ');
}
