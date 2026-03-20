import fs from 'fs';
import path from 'path';
import type { ContextState, ContextRequest } from './protocol';
import { hasContextStatePayload, parseContextState, parseContextRequest } from './protocol';

const DEFAULT_POLL_INTERVAL_MS = 500;

export interface ContextWatcherOptions {
  /** Workspace root directory containing .context/. */
  cwd: string;
  /** Poll interval in ms (default 500). */
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
 * Designed for simplicity and cross-platform reliability over fs.watch.
 * Silently skips parse errors (partial writes) and retries next cycle.
 */
export class ContextWatcher {
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

  constructor(options: ContextWatcherOptions) {
    this.statePath = path.join(options.cwd, '.context', 'state.json');
    this.requestsDir = path.join(options.cwd, '.context', 'requests');
    this.responsesDir = path.join(options.cwd, '.context', 'responses');
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onStateChange = options.onStateChange;
    this.onRequest = options.onRequest;
    this.shouldProcessRequest = options.shouldProcessRequest;
  }

  /** Start polling. Idempotent. */
  start(): void {
    if (this.timer || this.disposed) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
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
  writeResponse(id: string, ok: boolean, data?: Record<string, unknown>, error?: string): void {
    try {
      fs.mkdirSync(this.responsesDir, { recursive: true });
      const responsePath = path.join(this.responsesDir, `${id}.json`);
      fs.writeFileSync(responsePath, JSON.stringify({ id, ok, data, error }, null, 2));
    } catch {
      // Best-effort — agent can retry or timeout
    }
  }

  private poll(): void {
    this.pollState();
    if (this.onRequest) {
      this.pollRequests();
    }
  }

  private pollState(): void {
    let content: string;
    try {
      content = fs.readFileSync(this.statePath, 'utf-8');
    } catch {
      // File doesn't exist yet — that's fine
      return;
    }

    // Skip if content hasn't changed
    if (content === this.lastStateContent) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Partial write — skip and retry next cycle
      return;
    }

    const state = parseContextState(parsed);
    if (!state || !hasContextStatePayload(state)) return;

    this.lastStateContent = content;
    this.onStateChange(state);
  }

  private pollRequests(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.requestsDir);
    } catch {
      // Directory doesn't exist yet
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.replace('.json', '');
      if (this.processedRequestIds.has(id)) continue;
      if (fs.existsSync(path.join(this.responsesDir, `${id}.json`))) {
        this.processedRequestIds.add(id);
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(path.join(this.requestsDir, entry), 'utf-8');
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
      if (this.hasResponseForRequest(request.id)) {
        this.processedRequestIds.add(id);
        continue;
      }
      if (this.shouldProcessRequest && !this.shouldProcessRequest(request)) continue;

      this.processedRequestIds.add(id);
      this.onRequest!(request);
    }
  }

  private hasResponseForRequest(id: string): boolean {
    try {
      return fs.existsSync(path.join(this.responsesDir, `${id}.json`));
    } catch {
      return false;
    }
  }
}
