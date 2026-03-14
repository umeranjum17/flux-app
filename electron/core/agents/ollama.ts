import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { spawnAgentProcess, createStartupWatchdog, isMeaningfulMessage } from './spawn-utils';
import { classifySpawnError } from '../process-utils';

const OLLAMA_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Spawn an Ollama CLI subprocess for local model inference.
 * Ollama outputs plain text (or JSON with --format json), so we
 * stream text line by line as AgentMessage events.
 */
export function spawnOllama(options: SpawnOptions): AgentHandle {
  const model = options.model ?? 'llama3';

  const args: string[] = ['run', model];

  const proc: ChildProcess = spawnAgentProcess({
    command: options.binaryPath || 'ollama',
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'ollama';
  let stopped = false;
  let finished = false;

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    watchdog.clear();
    emitter.emit('done', result);
  };

  const watchdog = createStartupWatchdog({
    timeoutMs: OLLAMA_STARTUP_TIMEOUT_MS,
    label: 'Ollama',
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

  if (options.images?.length) {
    setTimeout(() => {
      emitMessage({
        type: 'text',
        role: 'system',
        content: 'Note: Images were attached but Ollama does not support image input. They will be ignored.',
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

  proc.stdout?.on('data', () => watchdog.resetProgress());
  proc.stderr?.on('data', () => watchdog.resetProgress());

  const startTime = Date.now();
  let fullText = '';
  let idleTimer: NodeJS.Timeout | null = null;
  const IDLE_TIMEOUT_MS = 3000;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // Ollama finished responding — send /bye to exit gracefully
      if (proc.stdin?.writable) {
        proc.stdin.write('/bye\n');
      }
    }, IDLE_TIMEOUT_MS);
  };

  // Send the prompt via stdin since `ollama run` reads from stdin
  if (proc.stdin?.writable) {
    proc.stdin.write(options.prompt + '\n');
  }

  const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    buffer += text;
    fullText += text;

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

    resetIdleTimer();

    emitMessage({
      type: 'text',
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    });
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;

    // Ollama may emit progress info (model loading) on stderr
    const isProgress = text.includes('pulling') ||
      text.includes('verifying') ||
      text.includes('writing') ||
      text.includes('%');

    emitMessage({
      type: isProgress ? 'text' : 'error',
      role: 'system',
      content: text,
      timestamp: Date.now(),
    });
  });

  proc.on('close', (code: number | null) => {
    if (idleTimer) clearTimeout(idleTimer);
    const durationMs = Date.now() - startTime;

    emitMessage({
      type: 'result',
      role: 'assistant',
      content: fullText.trim(),
      timestamp: Date.now(),
      durationMs,
    });
    finish({
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Ollama exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    if (idleTimer) clearTimeout(idleTimer);
    try { proc.kill(); } catch {}
    const info = classifySpawnError(err, { command: 'ollama', sshHost: options.sshHost });
    const content = `Failed to start Ollama: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`;
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
    if (idleTimer) clearTimeout(idleTimer);
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

  emitter.approve = (_requestId: string) => {
    // Ollama has no permission model
  };

  emitter.deny = (_requestId: string) => {
    // Not applicable
  };

  emitter.steer = (prompt: string) => {
    // Reset idle timer for follow-up messages
    if (idleTimer) clearTimeout(idleTimer);
    if (proc.stdin?.writable) {
      proc.stdin.write(prompt + '\n');
    }
  };

  emitter.answerQuestion = (_requestId: string, response: string) => {
    emitter.steer(response);
  };

  emitter.isAlive = () => !finished && !stopped;

  return emitter;
}
