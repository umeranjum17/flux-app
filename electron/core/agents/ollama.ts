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

  // Send the prompt via stdin since `ollama run` reads from stdin
  if (proc.stdin?.writable) {
    proc.stdin.write(options.prompt + '\n');
    // Signal end of input so ollama processes the prompt
    // but keep stdin open for follow-up steers
  }

  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    buffer += text;
    fullText += text;

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
    proc.kill('SIGTERM');
  };

  emitter.approve = (_requestId: string) => {
    // Ollama has no permission model
  };

  emitter.deny = (_requestId: string) => {
    // Not applicable
  };

  emitter.steer = (prompt: string) => {
    // Send follow-up messages via stdin
    if (proc.stdin?.writable) {
      proc.stdin.write(prompt + '\n');
    }
  };

  return emitter;
}
