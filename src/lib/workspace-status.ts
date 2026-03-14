import type { WorkspaceStatus } from './ipc-api';

export const workspaceStatusConfig: Record<WorkspaceStatus, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: 'bg-text-tertiary', label: 'Idle' },
  running: { color: 'bg-success', label: 'Running', pulse: true },
  waiting_approval: { color: 'bg-warning', label: 'Waiting', pulse: true },
  waiting_input: { color: 'bg-info', label: 'Question', pulse: true },
  done: { color: 'bg-info', label: 'Done' },
  error: { color: 'bg-error', label: 'Error' },
  merging: { color: 'bg-accent', label: 'Merging', pulse: true },
};
