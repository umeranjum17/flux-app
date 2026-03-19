import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import type {
  ContextRequest,
  TerminalExecPayload,
  TerminalSpawnPayload,
  TerminalKillPayload,
} from './protocol';


const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 300_000; // 5 min
const MAX_OUTPUT_BYTES = 100_000; // 100KB per stream
const FORCE_KILL_DELAY_MS = 3_000;

export interface TerminalActivity {
  action: string;
  command: string;
  terminalId?: string;
  exitCode?: number;
  error?: string;
}

export interface DispatchResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Dispatches `.context/requests/` actions to concrete handlers.
 *
 * Currently supports terminal actions (exec, spawn, kill).
 * New action families can be added by extending the switch in `dispatch()`.
 */
export interface VisibleTerminalRequest {
  id: string;
  command: string;
  cwd: string;
}

export class ContextRequestDispatcher {
  private readonly cwd: string;
  private readonly onActivity?: (activity: TerminalActivity) => void;
  private readonly onSpawnVisibleTerminal?: (request: VisibleTerminalRequest) => void;
  private readonly onKillVisibleTerminal?: (terminalId: string) => void;
  private readonly spawnedProcesses = new Map<string, { proc: ChildProcess; command: string }>();
  private readonly forceKillTimers = new Map<ChildProcess, ReturnType<typeof setTimeout>>();
  /** Terminal IDs spawned via visible terminals (PTY) rather than headless child_process. */
  private readonly visibleTerminals = new Set<string>();

  constructor(options: {
    cwd: string;
    onActivity?: (activity: TerminalActivity) => void;
    onSpawnVisibleTerminal?: (request: VisibleTerminalRequest) => void;
    onKillVisibleTerminal?: (terminalId: string) => void;
  }) {
    this.cwd = options.cwd;
    this.onActivity = options.onActivity;
    this.onSpawnVisibleTerminal = options.onSpawnVisibleTerminal;
    this.onKillVisibleTerminal = options.onKillVisibleTerminal;
  }

  async dispatch(request: ContextRequest): Promise<DispatchResult> {
    switch (request.action) {
      case 'terminal:exec':
        return this.handleExec(request);
      case 'terminal:spawn':
        return this.handleSpawn(request);
      case 'terminal:kill':
        return this.handleKill(request);
      default:
        return { ok: false, error: `Unknown action: ${request.action}` };
    }
  }

  /** Clean up all spawned background processes. */
  dispose(): void {
    for (const [, entry] of this.spawnedProcesses) {
      this.terminateProcess(entry.proc);
    }
    this.spawnedProcesses.clear();
    for (const id of this.visibleTerminals) {
      this.onKillVisibleTerminal?.(id);
    }
    this.visibleTerminals.clear();
  }

  // ── terminal:exec ──────────────────────────────────────────────────────

  private async handleExec(request: ContextRequest): Promise<DispatchResult> {
    const payload = request.payload as Partial<TerminalExecPayload> | undefined;
    if (!payload?.command) {
      return { ok: false, error: 'Missing required field: command' };
    }

    const timeout = Math.min(
      Math.max(payload.timeout ?? DEFAULT_EXEC_TIMEOUT_MS, 1000),
      MAX_EXEC_TIMEOUT_MS,
    );
    const cwd = payload.cwd ?? this.cwd;

    this.onActivity?.({ action: 'terminal:exec', command: payload.command });

    return new Promise<DispatchResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;

      const proc = spawn(payload.command!, [], {
        shell: true,
        cwd,
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      });

      const timer = setTimeout(() => {
        killed = true;
        this.terminateProcess(proc);
      }, timeout);

      const finish = (result: DispatchResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.clearForceKillTimer(proc);
        resolve(result);
      };

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
        stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
        const exitCode = code ?? (killed ? 124 : 1);

        this.onActivity?.({
          action: 'terminal:exec',
          command: payload.command!,
          exitCode,
        });

        if (killed) {
          finish({
            ok: false,
            data: { stdout, stderr, exitCode: exitCode || 124 },
            error: `Command timed out after ${timeout}ms`,
          });
        } else {
          finish({
            ok: exitCode === 0,
            data: { stdout, stderr, exitCode },
          });
        }
      });

      proc.on('error', (err) => {
        this.onActivity?.({
          action: 'terminal:exec',
          command: payload.command!,
          error: err.message,
        });
        finish({ ok: false, error: `Failed to execute: ${err.message}` });
      });
    });
  }

  // ── terminal:spawn ─────────────────────────────────────────────────────

  private handleSpawn(request: ContextRequest): DispatchResult {
    const payload = request.payload as Partial<TerminalSpawnPayload> | undefined;
    if (!payload?.command) {
      return { ok: false, error: 'Missing required field: command' };
    }

    const terminalId = crypto.randomUUID().slice(0, 8);
    const cwd = payload.cwd ?? this.cwd;

    // If a visible terminal callback is available, create a PTY terminal in the
    // terminal panel so the user can see the running process.
    if (this.onSpawnVisibleTerminal) {
      this.onSpawnVisibleTerminal({ id: terminalId, command: payload.command, cwd });
      this.visibleTerminals.add(terminalId);
      this.onActivity?.({ action: 'terminal:spawn', command: payload.command, terminalId });
      return { ok: true, data: { terminalId } };
    }

    let proc: ChildProcess;
    try {
      proc = spawn(payload.command, [], {
        shell: true,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        detached: false,
      });
    } catch (err) {
      return { ok: false, error: `Failed to spawn: ${err instanceof Error ? err.message : String(err)}` };
    }

    proc.on('error', () => {
      this.clearForceKillTimer(proc);
      this.spawnedProcesses.delete(terminalId);
    });
    proc.on('close', () => {
      this.clearForceKillTimer(proc);
      this.spawnedProcesses.delete(terminalId);
    });

    this.spawnedProcesses.set(terminalId, { proc, command: payload.command });
    this.onActivity?.({ action: 'terminal:spawn', command: payload.command, terminalId });

    return {
      ok: true,
      data: { terminalId },
    };
  }

  // ── terminal:kill ──────────────────────────────────────────────────────

  private handleKill(request: ContextRequest): DispatchResult {
    const payload = request.payload as Partial<TerminalKillPayload> | undefined;
    if (!payload?.terminalId) {
      return { ok: false, error: 'Missing required field: terminalId' };
    }

    // Visible terminals are managed by the PTY terminal system
    if (this.visibleTerminals.has(payload.terminalId)) {
      this.visibleTerminals.delete(payload.terminalId);
      this.onKillVisibleTerminal?.(payload.terminalId);
      this.onActivity?.({
        action: 'terminal:kill',
        command: '',
        terminalId: payload.terminalId,
      });
      return { ok: true };
    }

    const entry = this.spawnedProcesses.get(payload.terminalId);
    if (!entry) {
      return { ok: false, error: `No process found with terminalId: ${payload.terminalId}` };
    }

    this.terminateProcess(entry.proc);
    this.spawnedProcesses.delete(payload.terminalId);
    this.onActivity?.({
      action: 'terminal:kill',
      command: entry.command,
      terminalId: payload.terminalId,
    });

    return { ok: true };
  }

  private terminateProcess(proc: ChildProcess): void {
    if (proc.exitCode != null || proc.signalCode != null) return;

    try { proc.kill('SIGTERM'); } catch {}
    if (this.forceKillTimers.has(proc)) return;

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      this.clearForceKillTimer(proc);
    }, FORCE_KILL_DELAY_MS);

    this.forceKillTimers.set(proc, timer);
    proc.once('close', () => this.clearForceKillTimer(proc));
    proc.once('exit', () => this.clearForceKillTimer(proc));
  }

  private clearForceKillTimer(proc: ChildProcess): void {
    const timer = this.forceKillTimers.get(proc);
    if (!timer) return;
    clearTimeout(timer);
    this.forceKillTimers.delete(proc);
  }
}
