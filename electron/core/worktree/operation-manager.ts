import crypto from 'crypto';

import { logDiagnostic } from '../diagnostics/logger';
import type { Workspace, WorkspaceOperation, WorkspaceOperationStage } from './types';

type SendToRendererFn = (channel: string, payload: unknown) => boolean;

interface StartWorkspaceOperationOptions {
  workspace: Workspace;
  kind: WorkspaceOperation['kind'];
  initialMessage: string;
  run: (controls: WorkspaceOperationControls) => Promise<void>;
}

export interface WorkspaceOperationControls {
  signal: AbortSignal;
  update: (update: {
    stage: WorkspaceOperationStage;
    progress: number;
    message: string;
    cancellable?: boolean;
  }) => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class WorkspaceOperationManager {
  private readonly operations = new Map<string, WorkspaceOperation>();
  private readonly activeWorkspaceOperations = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly repoLocks = new Map<string, Promise<void>>();

  constructor(private readonly sendToRenderer: SendToRendererFn) {}

  list(): WorkspaceOperation[] {
    return [...this.operations.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(workspaceId: string): WorkspaceOperation | undefined {
    const activeId = this.activeWorkspaceOperations.get(workspaceId);
    if (activeId) {
      return this.operations.get(activeId);
    }

    return [...this.operations.values()]
      .filter((operation) => operation.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  }

  start(options: StartWorkspaceOperationOptions): WorkspaceOperation {
    const activeId = this.activeWorkspaceOperations.get(options.workspace.id);
    if (activeId) {
      const existing = this.operations.get(activeId);
      if (existing) return existing;
    }

    const now = Date.now();
    const operation: WorkspaceOperation = {
      id: crypto.randomUUID(),
      workspaceId: options.workspace.id,
      kind: options.kind,
      status: 'running',
      stage: 'queued',
      progress: 0.02,
      message: options.initialMessage,
      startedAt: now,
      updatedAt: now,
      cancellable: true,
    };

    const controller = new AbortController();
    this.operations.set(operation.id, operation);
    this.activeWorkspaceOperations.set(options.workspace.id, operation.id);
    this.controllers.set(operation.id, controller);
    this.emit(operation);

    void this.runWithRepoLock(options.workspace.parentRepo, async () => {
      try {
        await options.run({
          signal: controller.signal,
          update: (update) => this.patch(operation.id, update),
        });

        if (controller.signal.aborted) {
          this.finish(operation.id, {
            status: 'cancelled',
            stage: 'cancelled',
            progress: 1,
            message: 'Archive cancelled',
            error: 'Archive cancelled',
          });
          return;
        }

        this.finish(operation.id, {
          status: 'completed',
          stage: 'completed',
          progress: 1,
          message: 'Archive complete',
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          this.finish(operation.id, {
            status: 'cancelled',
            stage: 'cancelled',
            progress: 1,
            message: 'Archive cancelled',
            error: error instanceof Error ? error.message : 'Archive cancelled',
          });
          return;
        }

        logDiagnostic('workspace:archive', 'operation failed', {
          workspaceId: options.workspace.id,
          operationId: operation.id,
          error: error instanceof Error ? error.message : String(error),
        });
        this.finish(operation.id, {
          status: 'failed',
          stage: 'failed',
          progress: 1,
          message: 'Archive failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return operation;
  }

  cancel(operationId: string): void {
    const controller = this.controllers.get(operationId);
    if (!controller) return;
    controller.abort();
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
  }

  private patch(
    operationId: string,
    update: {
      stage: WorkspaceOperationStage;
      progress: number;
      message: string;
      cancellable?: boolean;
    },
  ): void {
    const existing = this.operations.get(operationId);
    if (!existing) return;

    const next: WorkspaceOperation = {
      ...existing,
      ...update,
      updatedAt: Date.now(),
      cancellable: update.cancellable ?? existing.cancellable,
    };
    this.operations.set(operationId, next);
    this.emit(next);
  }

  private finish(
    operationId: string,
    update: {
      status: WorkspaceOperation['status'];
      stage: WorkspaceOperationStage;
      progress: number;
      message: string;
      error?: string;
    },
  ): void {
    const existing = this.operations.get(operationId);
    if (!existing) return;

    const next: WorkspaceOperation = {
      ...existing,
      ...update,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      cancellable: false,
    };

    this.operations.set(operationId, next);
    this.activeWorkspaceOperations.delete(existing.workspaceId);
    this.controllers.delete(operationId);
    this.emit(next);
  }

  private emit(operation: WorkspaceOperation): void {
    this.sendToRenderer('workspace:operation', operation);
  }

  private async runWithRepoLock(parentRepo: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.repoLocks.get(parentRepo) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.repoLocks.set(parentRepo, current);

    await previous;
    try {
      await fn();
    } finally {
      release();
      if (this.repoLocks.get(parentRepo) === current) {
        this.repoLocks.delete(parentRepo);
      }
    }
  }
}
