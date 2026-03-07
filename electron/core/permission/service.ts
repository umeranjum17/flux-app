import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface PermissionRequest {
  requestId: string;
  taskId: string;
  toolName: string;
  description: string;
  action?: string;
  path?: string;
}

export class PermissionService extends EventEmitter {
  private pending: Map<
    string,
    { resolve: (value: boolean) => void; reject: (reason?: unknown) => void }
  > = new Map();

  request(
    taskId: string,
    toolName: string,
    description: string,
    action?: string,
    path?: string
  ): Promise<boolean> {
    const requestId = crypto.randomUUID();

    return new Promise<boolean>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });

      this.emit('permission:request', {
        requestId,
        taskId,
        toolName,
        description,
        action,
        path,
      } satisfies PermissionRequest);
    });
  }

  approve(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve(true);
  }

  deny(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve(false);
  }
}
