import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { spawnAgentProcess } from './spawn-utils';

/**
 * Spawn an Ollama CLI subprocess for local model inference.
 * Ollama outputs plain text (or JSON with --format json), so we
 * stream text line by line as AgentMessage events.
 */
export function spawnOllama(options: SpawnOptions): AgentHandle {
  const model = options.model ?? 'llama3';

  const args: string[] = ['run', model];

  const proc: ChildProcess = spawnAgentProcess({
    command: options.sshHost ? 'ollama' : (options.binaryPath || 'ollama'),
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'ollama';
  let stopped = false;

  if (options.images?.length) {
    setTimeout(() => {
      emitter.emit('message', {
        type: 'text',
        role: 'system',
        content: 'Note: Images were attached but Ollama does not support image input. They will be ignored.',
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

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

  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    buffer += text;
    fullText += text;

    resetIdleTimer();

    // Emit text chunks as they arrive for real-time streaming
    const msg: AgentMessage = {
      type: 'text',
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    };
    emitter.emit('message', msg);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (text) {
      // Ollama may emit progress info (model loading) on stderr
      // Only treat actual errors as errors
      const isProgress = text.includes('pulling') ||
        text.includes('verifying') ||
        text.includes('writing') ||
        text.includes('%');

      const msg: AgentMessage = {
        type: isProgress ? 'text' : 'error',
        role: 'system',
        content: text,
        timestamp: Date.now(),
      };
      emitter.emit('message', msg);
    }
  });

  proc.on('close', (code: number | null) => {
    if (idleTimer) clearTimeout(idleTimer);
    const durationMs = Date.now() - startTime;

    // Emit final result
    const resultMsg: AgentMessage = {
      type: 'result',
      role: 'assistant',
      content: fullText.trim(),
      timestamp: Date.now(),
      durationMs,
    };
    emitter.emit('message', resultMsg);
    emitter.emit('done', {
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Ollama exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const msg: AgentMessage = {
      type: 'error',
      role: 'system',
      content: `Failed to spawn ollama: ${err.message}`,
      timestamp: Date.now(),
    };
    emitter.emit('message', msg);
    emitter.emit('done', { code: 1, error: err.message });
  });

  emitter.stop = () => {
    stopped = true;
    if (idleTimer) clearTimeout(idleTimer);
    proc.kill('SIGTERM');
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

  return emitter;
}
