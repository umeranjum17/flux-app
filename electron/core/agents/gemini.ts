import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { spawnAgentProcess, createStartupWatchdog, filterStderrNoise, isMeaningfulMessage } from './spawn-utils';
import { classifySpawnError, attachChildStdinErrorHandler, safeWriteToChildStdin } from '../process-utils';

const GEMINI_STARTUP_TIMEOUT_MS = 20_000;

/**
 * Spawn a Gemini CLI subprocess and parse its NDJSON stream output.
 */
export function spawnGemini(options: SpawnOptions): AgentHandle {
  const args: string[] = [
    '--output-format', 'stream-json',
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  // Prompt as last positional argument
  args.push(options.prompt);

  const proc: ChildProcess = spawnAgentProcess({
    command: options.binaryPath || 'gemini',
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });
  attachChildStdinErrorHandler(proc, 'gemini');

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'gemini';
  let stopped = false;
  let finished = false;

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    watchdog.clear();
    emitter.emit('done', result);
  };

  const watchdog = createStartupWatchdog({
    timeoutMs: GEMINI_STARTUP_TIMEOUT_MS,
    label: 'Gemini',
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
    cwd: options.cwd,
    onTimeout: (error) => {
      if (finished || stopped) return;
      try { proc.kill('SIGTERM'); } catch {}
      emitMessage({
        type: 'error',
        role: 'system',
        content: error,
        timestamp: Date.now(),
      });
      finish({ code: 1, error });
    },
  });

  const emitMessage = (message: AgentMessage) => {
    if (isMeaningfulMessage(message)) {
      watchdog.markProgress();
    }
    emitter.emit('message', message);
  };

  if (options.sshHost) {
    setTimeout(() => {
      emitMessage({
        type: 'status',
        role: 'system',
        statusKind: 'spawn',
        content: `[SSH] Spawning gemini on ${options.sshHost} (cwd: ${options.remoteCwd ?? options.cwd})`,
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

  proc.stdout?.on('data', () => watchdog.resetProgress());
  proc.stderr?.on('data', () => watchdog.resetProgress());

  const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
  let buffer = '';

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

      const message = mapGeminiEvent(event);
      if (message) {
        emitMessage(message);
      }
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;

    const actionable = filterStderrNoise(text);
    if (!actionable) return;

    emitMessage({
      type: 'error',
      role: 'system',
      content: actionable,
      timestamp: Date.now(),
    });
  });

  proc.on('close', (code: number | null) => {
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const message = mapGeminiEvent(event);
        if (message) {
          emitMessage(message);
        }
      } catch {
        // ignore
      }
    }
    finish({
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Gemini exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const info = classifySpawnError(err, { command: 'gemini', sshHost: options.sshHost });
    const content = `Failed to start Gemini: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`;
    emitMessage({
      type: 'error',
      role: 'system',
      content,
      timestamp: Date.now(),
    });
    finish({ code: 1, error: content });
  });

  let exitPromise: Promise<void> | null = null;
  emitter.stop = () => {
    if (exitPromise) return exitPromise;
    stopped = true;
    watchdog.clear();
    exitPromise = new Promise<void>((resolve) => {
      if (finished) { resolve(); return; }
      proc.once('close', () => resolve());
      try { proc.kill('SIGTERM'); } catch {}
      const forceKillTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 5000);
      proc.once('close', () => clearTimeout(forceKillTimer));
    });
    return exitPromise;
  };

  emitter.approve = (requestId: string) => {
    safeWriteToChildStdin(proc, JSON.stringify({ type: 'approve', requestId }) + '\n', 'gemini');
  };

  emitter.deny = (requestId: string) => {
    safeWriteToChildStdin(proc, JSON.stringify({ type: 'deny', requestId }) + '\n', 'gemini');
  };

  emitter.steer = (prompt: string, images?: string[]) => {
    const payload: Record<string, unknown> = { type: 'user_message', content: prompt };
    if (images?.length) {
      payload.images = images;
    }
    safeWriteToChildStdin(proc, JSON.stringify(payload) + '\n', 'gemini');
  };

  emitter.answerQuestion = (_requestId: string, response: string) => {
    emitter.steer(response);
  };

  emitter.isAlive = () => !finished && !stopped;

  return emitter;
}

/**
 * Map a Gemini stream-json event to our unified AgentMessage format.
 */
function mapGeminiEvent(event: any): AgentMessage | null {
  const now = Date.now();

  // Text content from model
  if (event.type === 'text' || event.type === 'content') {
    return {
      type: 'text',
      role: 'assistant',
      content: event.text ?? event.content ?? '',
      timestamp: now,
    };
  }

  // Streaming text delta
  if (event.type === 'text_delta' || event.type === 'content_delta') {
    return {
      type: 'text',
      role: 'assistant',
      content: event.text ?? event.delta ?? '',
      timestamp: now,
    };
  }

  // Thinking / internal reasoning
  if (event.type === 'thinking' || event.type === 'thought') {
    return {
      type: 'thinking',
      role: 'assistant',
      content: event.text ?? event.thought ?? '',
      timestamp: now,
    };
  }

  // Tool/function call
  if (event.type === 'tool_call' || event.type === 'function_call') {
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Using tool: ${event.name ?? event.function_name ?? 'unknown'}`,
      timestamp: now,
      toolName: event.name ?? event.function_name,
      toolInput: event.args ?? event.input ?? {},
      toolCallId: event.id ?? event.call_id,
    };
  }

  // Tool/function result
  if (event.type === 'tool_result' || event.type === 'function_response') {
    const content = typeof event.output === 'string'
      ? event.output
      : JSON.stringify(event.output ?? event.response ?? '');

    return {
      type: 'tool_result',
      role: 'tool',
      content,
      timestamp: now,
      toolCallId: event.id ?? event.call_id,
      isError: event.is_error ?? false,
    };
  }

  // Permission request
  if (event.type === 'permission_request') {
    return {
      type: 'permission_request',
      role: 'system',
      content: event.description ?? 'Permission requested',
      timestamp: now,
      requestId: event.request_id,
      toolName: event.tool_name ?? event.action,
      action: event.tool_name ?? event.action,
      filePath: event.file_path,
    };
  }

  // Final result
  if (event.type === 'result' || event.type === 'done') {
    return {
      type: 'result',
      role: 'assistant',
      content: event.result ?? event.text ?? '',
      timestamp: now,
      costUsd: event.cost_usd ?? event.usage?.cost_usd,
      inputTokens: event.usage?.input_tokens,
      outputTokens: event.usage?.output_tokens,
      durationMs: event.duration_ms,
    };
  }

  // Error
  if (event.type === 'error') {
    return {
      type: 'error',
      role: 'system',
      content: event.message ?? event.error ?? JSON.stringify(event),
      timestamp: now,
    };
  }

  return null;
}
