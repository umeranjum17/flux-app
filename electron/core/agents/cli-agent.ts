import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, AgentId, SpawnOptions, AgentMessage } from './types';
import {
  spawnAgentProcess,
  createStartupWatchdog,
  filterStderrNoise,
  isMeaningfulMessage,
  terminateAgentProcess,
  classifyErrorContent,
  type StartupWatchdog,
} from './spawn-utils';
import { classifySpawnError, attachChildStdinErrorHandler } from '../process-utils';

/** Passed to hooks so they can interact with the agent lifecycle. */
export interface CliAgentContext {
  emitter: AgentHandle;
  proc: ChildProcess;
  emitMessage: (msg: AgentMessage) => void;
  finish: (result: { code: number | null; error?: string }) => void;
  requestShutdown: () => Promise<void>;
  watchdog: StartupWatchdog;
  options: SpawnOptions;
  isStopped: () => boolean;
  isFinished: () => boolean;
  getLastStderrError: () => string;
  getBuffer: () => string;
}

export interface CliAgentConfig {
  agentId: AgentId;
  label: string;
  defaultCommand: string;
  startupTimeoutMs: number;

  /** Build CLI args from SpawnOptions. */
  buildArgs(options: SpawnOptions): string[];

  /** Map a parsed JSON event to AgentMessage(s). */
  mapEvent(event: Record<string, any>): AgentMessage | AgentMessage[] | null;

  /** Classify non-zero exit code + stderr into a user-facing message. */
  classifyExit(code: number | null, stderr: string): string;

  /** Control protocol methods — each defaults to no-op. */
  controls?: {
    approve?(proc: ChildProcess, requestId: string): void;
    deny?(proc: ChildProcess, requestId: string): void;
    steer?(proc: ChildProcess, prompt: string, images?: string[]): void;
    answerQuestion?(proc: ChildProcess, requestId: string, response: string): void;
  };

  /** Optional hooks for agent-specific behavior. */
  hooks?: {
    /**
     * Called for each parsed JSON event BEFORE mapEvent.
     * Return true to suppress the default mapEvent handling for this event.
     */
    onEvent?(event: Record<string, any>, ctx: CliAgentContext): boolean;

    /**
     * Called for each raw stdout line BEFORE JSON parsing.
     * Return true to suppress default JSON parse + map for this line.
     */
    onRawLine?(line: string, ctx: CliAgentContext): boolean;

    /** Extract session metadata from a parsed event. Emits 'session-meta' on the handle. */
    extractSessionMeta?(event: Record<string, any>): unknown | null;

    /**
     * Called before finish() on process close.
     * Return true to PREVENT the default finish (e.g. for session retry).
     */
    onBeforeFinish?(code: number | null, ctx: CliAgentContext): boolean;

    /** Send initial prompt to stdin after spawn (e.g. Ollama reads from stdin). */
    sendInitialPrompt?(proc: ChildProcess, options: SpawnOptions): void;

    /** Additional cleanup on finish (e.g. temp dir removal). */
    onCleanup?(): void;

    /** Custom isAlive check (default: !finished && !stopped). */
    isAlive?(state: { finished: boolean; stopped: boolean; proc: ChildProcess }): boolean;

    /** Called right after spawn, before stdout begins flowing. For setup like heartbeat intervals. */
    onAfterSpawn?(proc: ChildProcess, ctx: CliAgentContext): void;

    /** Called when the watchdog fires. Return true to suppress default timeout handling. */
    onTimeout?(error: string, ctx: CliAgentContext): boolean;

    /** Custom stderr handler. Return true to suppress default stderr handling for this chunk. */
    onStderr?(text: string, ctx: CliAgentContext): boolean;

    /** Called in stop() before shutdown. For cleaning up timers etc. */
    onStop?(): void;
  };
}

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export function createCliAgentHandle(
  options: SpawnOptions,
  config: CliAgentConfig,
): AgentHandle {
  const args = config.buildArgs(options);

  const proc: ChildProcess = spawnAgentProcess({
    command: options.binaryPath || config.defaultCommand,
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });
  attachChildStdinErrorHandler(proc, config.defaultCommand);

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = config.agentId;
  emitter.pid = proc.pid;

  let stopped = false;
  let finished = false;
  let timeoutError: string | undefined;
  let shutdownPromise: Promise<void> | null = null;
  let lastStderrError = '';
  let buffer = '';

  const requestShutdown = () => {
    shutdownPromise ??= terminateAgentProcess(proc);
    return shutdownPromise;
  };

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    watchdog.clear();
    config.hooks?.onCleanup?.();
    emitter.emit('done', result);
  };

  const watchdog = createStartupWatchdog({
    timeoutMs: config.startupTimeoutMs,
    label: config.label,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
    cwd: options.cwd,
    onTimeout: (error) => {
      if (finished || stopped) return;
      if (config.hooks?.onTimeout?.(error, ctx)) return;
      timeoutError = error;
      emitMessage({
        type: 'error',
        role: 'system',
        content: error,
        timestamp: Date.now(),
      });
      void requestShutdown().finally(() => finish({ code: 1, error }));
    },
  });

  const emitMessage = (message: AgentMessage) => {
    if (isMeaningfulMessage(message)) {
      watchdog.markProgress();
    }
    emitter.emit('message', message);
  };

  const ctx: CliAgentContext = {
    emitter,
    proc,
    emitMessage,
    finish,
    requestShutdown,
    watchdog,
    options,
    isStopped: () => stopped,
    isFinished: () => finished,
    getLastStderrError: () => lastStderrError,
    getBuffer: () => buffer,
  };

  // SSH spawn notification
  if (options.sshHost) {
    setTimeout(() => {
      emitMessage({
        type: 'status',
        role: 'system',
        statusKind: 'spawn',
        content: `[SSH] Spawning ${config.defaultCommand} on ${options.sshHost} (cwd: ${options.remoteCwd ?? options.cwd})`,
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

  // Post-spawn hook (heartbeats, initial messages, etc.)
  config.hooks?.onAfterSpawn?.(proc, ctx);

  // Send initial prompt if agent reads from stdin
  config.hooks?.sendInitialPrompt?.(proc, options);

  // Watchdog reset on stdout activity
  proc.stdout?.on('data', () => watchdog.resetProgress());

  // NDJSON stdout processing
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    if (buffer.length > MAX_BUFFER) {
      buffer = '';
      emitMessage({
        type: 'error',
        role: 'system',
        content: 'Stream buffer overflow - cleared',
        timestamp: Date.now(),
      });
      return;
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Let agent handle raw lines if needed
      if (config.hooks?.onRawLine?.(trimmed, ctx)) continue;

      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        // Plain text fallback
        emitMessage({
          type: 'text',
          role: 'assistant',
          content: trimmed,
          timestamp: Date.now(),
        } satisfies AgentMessage);
        continue;
      }

      // Session metadata extraction
      const sessionMeta = config.hooks?.extractSessionMeta?.(event);
      if (sessionMeta) {
        emitter.emit('session-meta', sessionMeta);
      }

      // Agent-specific pre-processing
      if (config.hooks?.onEvent?.(event, ctx)) continue;

      // Default event mapping
      const message = config.mapEvent(event);
      if (message) {
        const msgs = Array.isArray(message) ? message : [message];
        for (const m of msgs) emitMessage(m);
      }
    }
  });

  // Stderr handling
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;

    // Agent-specific stderr handling
    if (config.hooks?.onStderr?.(text, ctx)) return;

    const actionable = filterStderrNoise(text);
    if (!actionable) return;
    lastStderrError = actionable;

    const classified = classifyErrorContent(actionable);
    emitMessage({
      type: 'error',
      role: 'system',
      content: classified?.message ?? actionable,
      timestamp: Date.now(),
      ...(classified ? { errorKind: classified.errorKind } : {}),
    });
  });

  // Process close
  proc.on('close', (code: number | null) => {
    // Let agent handle close (e.g. session retry)
    if (config.hooks?.onBeforeFinish?.(code, ctx)) return;

    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const sessionMeta = config.hooks?.extractSessionMeta?.(event);
        if (sessionMeta) {
          emitter.emit('session-meta', sessionMeta);
        }
        // Route through onEvent hook for consistency (e.g. Claude's post-processing)
        if (!config.hooks?.onEvent?.(event, ctx)) {
          const message = config.mapEvent(event);
          if (message) {
            const msgs = Array.isArray(message) ? message : [message];
            for (const m of msgs) emitMessage(m);
          }
        }
      } catch {
        // ignore
      }
    }

    const exitError = timeoutError ?? (stopped || code === 0 || code === null
      ? undefined
      : config.classifyExit(code, lastStderrError));

    finish({
      code,
      ...(exitError ? { error: exitError } : {}),
    });
  });

  // Process spawn error
  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const info = classifySpawnError(err, { command: config.defaultCommand, sshHost: options.sshHost });
    const content = `Failed to start ${config.label}: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`;
    emitMessage({
      type: 'error',
      role: 'system',
      content,
      timestamp: Date.now(),
    });
    finish({ code: 1, error: content });
  });

  // stop()
  let exitPromise: Promise<void> | null = null;
  emitter.stop = () => {
    if (exitPromise) return exitPromise;
    stopped = true;
    watchdog.clear();
    config.hooks?.onStop?.();
    if (finished) {
      config.hooks?.onCleanup?.();
      exitPromise = Promise.resolve();
      return exitPromise;
    }
    exitPromise = requestShutdown().finally(() => {
      config.hooks?.onCleanup?.();
    });
    return exitPromise;
  };

  // Control methods
  emitter.approve = (requestId: string) => {
    config.controls?.approve?.(proc, requestId);
  };
  emitter.deny = (requestId: string) => {
    config.controls?.deny?.(proc, requestId);
  };
  emitter.steer = (prompt: string, images?: string[]) => {
    config.controls?.steer?.(proc, prompt, images);
  };
  emitter.answerQuestion = (requestId: string, response: string) => {
    config.controls?.answerQuestion?.(proc, requestId, response);
  };

  // isAlive
  emitter.isAlive = () => {
    if (config.hooks?.isAlive) {
      return config.hooks.isAlive({ finished, stopped, proc });
    }
    return !finished && !stopped;
  };

  return emitter;
}
