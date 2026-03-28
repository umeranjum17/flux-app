import fs from 'fs';
import path from 'path';
import type { ContextState, ContextRequest } from './protocol';
import { hasContextStatePayload, parseContextState, parseContextRequest } from './protocol';
import { createWorkspaceFs, type WorkspaceFs } from '../worktree/workspace-fs';

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_SSH_POLL_INTERVAL_MS = 2000;

export interface ContextWatcherOptions {
  /** Workspace root directory containing .context/. */
  cwd: string;
  /** SSH host for remote workspaces. When set, polls via SSH instead of local fs. */
  host?: string;
  /** Poll interval in ms (default 500 local, 2000 SSH). */
  pollIntervalMs?: number;
  /** Called when .context/state.json changes with valid data. */
  onStateChange: (state: ContextState) => void;
  /** Called when a new request file appears in .context/requests/. */
  onRequest?: (request: ContextRequest) => void;
  /** Optional gate for whether a parsed request should be claimed now. */
  shouldProcessRequest?: (request: ContextRequest) => boolean;
}

/**
 * Polls `.context/state.json` and `.context/requests/` for changes.
 *
 * Uses WorkspaceFs to work identically for local and remote (SSH) workspaces.
 * Silently skips parse errors (partial writes) and retries next cycle.
 */
export class ContextWatcher {
  private readonly wfs: WorkspaceFs;
  private readonly joinPath: (...paths: string[]) => string;
  private readonly statePath: string;
  private readonly requestsDir: string;
  private readonly responsesDir: string;
  private readonly pollIntervalMs: number;
  private readonly onStateChange: (state: ContextState) => void;
  private readonly onRequest?: (request: ContextRequest) => void;
  private readonly shouldProcessRequest?: (request: ContextRequest) => boolean;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStateContent = '';
  private processedRequestIds = new Set<string>();
  private disposed = false;
  private polling = false;

  constructor(options: ContextWatcherOptions) {
    this.wfs = createWorkspaceFs(options.host);
    this.joinPath = options.host ? path.posix.join : path.join;
    this.statePath = this.joinPath(options.cwd, '.context', 'state.json');
    this.requestsDir = this.joinPath(options.cwd, '.context', 'requests');
    this.responsesDir = this.joinPath(options.cwd, '.context', 'responses');
    this.pollIntervalMs = options.pollIntervalMs
      ?? (options.host ? DEFAULT_SSH_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS);
    this.onStateChange = options.onStateChange;
    this.onRequest = options.onRequest;
    this.shouldProcessRequest = options.shouldProcessRequest;
  }

  /** Start polling. Idempotent. */
  start(): void {
    if (this.timer || this.disposed) return;
    if (!this.wfs.isRemote) {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /** Stop polling and clean up. Idempotent. */
  stop(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the watcher has received at least one valid state update. */
  get hasReceivedState(): boolean {
    return this.lastStateContent !== '';
  }

  /** Write a response file for a processed request. */
  async writeResponse(id: string, ok: boolean, data?: Record<string, unknown>, error?: string): Promise<void> {
    try {
      const responsePath = this.responsePathFor(id);
      await this.wfs.writeFile(responsePath, JSON.stringify({ id, ok, data, error }, null, 2));
    } catch {
      // Best-effort — agent can retry or timeout
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || this.disposed) return;
    this.polling = true;
    try {
      await this.pollState();
      if (this.onRequest) {
        await this.pollRequests();
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollState(): Promise<void> {
    let content: string;
    try {
      const nextContent = await this.wfs.readFile(this.statePath);
      if (!nextContent) return;
      content = nextContent;
    } catch {
      return;
    }

    if (content === this.lastStateContent) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }

    const state = parseContextState(parsed);
    if (!state || !hasContextStatePayload(state)) return;

    this.lastStateContent = content;
    this.onStateChange(state);
  }

  private async pollRequests(): Promise<void> {
    let entries: string[];
    try {
      entries = await this.wfs.listDir(this.requestsDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.replace('.json', '');
      if (this.processedRequestIds.has(id)) continue;
      if (await this.hasResponseForRequest(id)) {
        this.processedRequestIds.add(id);
        continue;
      }

      let content: string;
      try {
        const nextContent = await this.wfs.readFile(this.joinPath(this.requestsDir, entry));
        if (!nextContent) continue;
        content = nextContent;
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        continue;
      }

      const request = parseContextRequest(parsed);
      if (!request) continue;
      if (await this.hasResponseForRequest(request.id)) {
        this.processedRequestIds.add(id);
        continue;
      }
      if (this.shouldProcessRequest && !this.shouldProcessRequest(request)) continue;

      this.processedRequestIds.add(id);
      this.onRequest!(request);
    }
  }

  private responsePathFor(id: string): string {
    return this.joinPath(this.responsesDir, `${id}.json`);
  }

  private async hasResponseForRequest(id: string): Promise<boolean> {
    return this.wfs.exists(this.responsePathFor(id));
  }
}
