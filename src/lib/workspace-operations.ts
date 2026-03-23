import type { WorkspaceOperation } from './ipc-api';
import { useWorkspaceStore } from '../stores/workspace';

export async function archiveWorkspace(workspaceId: string): Promise<WorkspaceOperation> {
  const current = useWorkspaceStore.getState().workspaceOperations.get(workspaceId);
  if (current?.kind === 'archive' && current.status === 'running') {
    return current;
  }

  const optimistic: WorkspaceOperation = {
    id: `archive:${workspaceId}:pending`,
    workspaceId,
    kind: 'archive',
    status: 'running',
    stage: 'queued',
    progress: 0.01,
    message: 'Queueing archive',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    cancellable: false,
  };
  useWorkspaceStore.getState().setWorkspaceOperation(optimistic);

  try {
    const result = await window.api.invoke('workspace:archive', { workspaceId }) as { operation: WorkspaceOperation | null };
    if (result.operation) {
      useWorkspaceStore.getState().setWorkspaceOperation(result.operation);
    } else {
      // Workspace was already removed — clear optimistic state
      useWorkspaceStore.getState().clearWorkspaceOperation(workspaceId);
    }
    return result.operation;
  } catch (error) {
    useWorkspaceStore.getState().clearWorkspaceOperation(workspaceId);
    throw error;
  }
}

export async function cancelWorkspaceOperation(operationId: string): Promise<void> {
  await window.api.invoke('workspace:cancel-operation', { operationId });
}

export function isWorkspaceArchiving(operation: WorkspaceOperation | undefined): boolean {
  return operation?.kind === 'archive' && operation.status === 'running';
}

export function formatWorkspaceOperationLabel(operation: WorkspaceOperation | undefined): string | null {
  if (!operation) return null;
  return operation.message;
}
