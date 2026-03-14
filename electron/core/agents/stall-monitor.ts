export interface StallInfo {
  type: 'tool_timeout' | 'idle_timeout';
  toolCallId?: string;
  toolName?: string;
  durationMs: number;
  autoRestartsRemaining: number;
}

export interface StallMonitorOptions {
  taskId: string;
  maxAutoRestarts: number;
  onStallDetected: (info: StallInfo) => void;
  onProcessDead: () => void;
}

/**
 * Per-tool timeout defaults (ms).
 * Aggressive thresholds — detect fast, recover seamlessly.
 */
const TOOL_TIMEOUTS: Record<string, number> = {
  Read: 30_000,
  Glob: 30_000,
  Edit: 30_000,
  Write: 30_000,
  NotebookEdit: 30_000,
  Grep: 45_000,
  Bash: 180_000,
  Agent: 180_000,
  shell: 180_000,
};
const DEFAULT_TOOL_TIMEOUT = 60_000;
const IDLE_TIMEOUT = 45_000;
const HEALTH_CHECK_INTERVAL = 10_000;

function getToolTimeout(toolName: string | undefined): number {
  if (!toolName) return DEFAULT_TOOL_TIMEOUT;
  return TOOL_TIMEOUTS[toolName] ?? DEFAULT_TOOL_TIMEOUT;
}

/**
 * Main-process stall monitor for agent sessions.
 *
 * Tracks per-tool-call durations and overall idle time.
 * Fires callbacks when thresholds are exceeded so the caller
 * can trigger auto-recovery or notify the renderer.
 */
export class StallMonitor {
  private toolTimers = new Map<string, NodeJS.Timeout>();
  private toolStartTimes = new Map<string, number>();
  private idleTimer: NodeJS.Timeout | null = null;
  private healthInterval: NodeJS.Timeout | null = null;
  private disposed = false;
  private restartCount = 0;

  constructor(private options: StallMonitorOptions) {
    this.resetIdleTimer();
  }

  /** Record that a tool call has started. Begins a per-tool timeout. */
  trackToolCall(toolCallId: string, toolName?: string): void {
    if (this.disposed) return;

    // Clear any existing timer for this ID (shouldn't happen, but defensive)
    this.clearToolTimer(toolCallId);

    const timeout = getToolTimeout(toolName);
    this.toolStartTimes.set(toolCallId, Date.now());

    const timer = setTimeout(() => {
      if (this.disposed) return;
      const startTime = this.toolStartTimes.get(toolCallId);
      const durationMs = startTime ? Date.now() - startTime : timeout;
      this.clearToolTimer(toolCallId);
      this.options.onStallDetected({
        type: 'tool_timeout',
        toolCallId,
        toolName,
        durationMs,
        autoRestartsRemaining: Math.max(0, this.options.maxAutoRestarts - this.restartCount),
      });
    }, timeout);

    this.toolTimers.set(toolCallId, timer);
  }

  /** Record that a tool call has completed. Clears its timeout. */
  trackToolResult(toolCallId: string): void {
    this.clearToolTimer(toolCallId);
    this.resetIdleTimer();
  }

  /** Record any meaningful activity. Resets the idle timer. */
  markActivity(): void {
    this.resetIdleTimer();
  }

  /** Increment the restart counter (called after an auto-recovery). */
  recordRestart(): void {
    this.restartCount++;
  }

  /** Start periodic health checks using the agent's isAlive callback. */
  startHealthCheck(isAlive: () => boolean): void {
    if (this.disposed) return;
    this.stopHealthCheck();

    this.healthInterval = setInterval(() => {
      if (this.disposed) return;

      if (!isAlive()) {
        this.dispose();
        this.options.onProcessDead();
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  /** Clean up all timers. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const timer of this.toolTimers.values()) {
      clearTimeout(timer);
    }
    this.toolTimers.clear();
    this.toolStartTimes.clear();

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.stopHealthCheck();
  }

  private clearToolTimer(toolCallId: string): void {
    const timer = this.toolTimers.get(toolCallId);
    if (timer) {
      clearTimeout(timer);
      this.toolTimers.delete(toolCallId);
    }
    this.toolStartTimes.delete(toolCallId);
  }

  private resetIdleTimer(): void {
    if (this.disposed) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      if (this.disposed) return;
      this.options.onStallDetected({
        type: 'idle_timeout',
        durationMs: IDLE_TIMEOUT,
        autoRestartsRemaining: Math.max(0, this.options.maxAutoRestarts - this.restartCount),
      });
    }, IDLE_TIMEOUT);
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }
}
