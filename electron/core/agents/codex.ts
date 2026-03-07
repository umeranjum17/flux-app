import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';

/**
 * Spawn a Codex CLI subprocess and parse its JSONL output.
 */
export function spawnCodex(options: SpawnOptions): AgentHandle {
  const args: string[] = ['exec', '--json'];

  if (options.mode === 'act') {
    args.push('--full-auto');
  } else if (options.mode === 'plan') {
    args.push('--sandbox', 'read-only');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  // Prompt as last positional argument
  args.push(options.prompt);

  const proc: ChildProcess = spawn('codex', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'codex';
  let stopped = false;

  if (options.images?.length) {
    setTimeout(() => {
      emitter.emit('message', {
        type: 'text',
        role: 'system',
        content: 'Note: Images were attached but Codex does not support image input. They will be ignored.',
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        // Plain text output — emit as text
        emitter.emit('message', {
          type: 'text',
          role: 'assistant',
          content: trimmed,
          timestamp: Date.now(),
        } satisfies AgentMessage);
        continue;
      }

      const message = mapCodexEvent(event);
      if (message) {
        emitter.emit('message', message);
      }
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (text) {
      const msg: AgentMessage = {
        type: 'error',
        role: 'system',
        content: text,
        timestamp: Date.now(),
      };
      emitter.emit('message', msg);
    }
  });

  proc.on('close', (code: number | null) => {
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const message = mapCodexEvent(event);
        if (message) {
          emitter.emit('message', message);
        }
      } catch {
        // ignore
      }
    }
    emitter.emit('done', {
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Codex exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const msg: AgentMessage = {
      type: 'error',
      role: 'system',
      content: `Failed to spawn codex: ${err.message}`,
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
    // Codex in --full-auto mode handles permissions automatically.
    // In sandbox mode, no approvals are needed.
  };

  emitter.deny = (_requestId: string) => {
    // Not applicable for Codex in auto/sandbox modes
  };

  emitter.steer = (prompt: string) => {
    if (proc.stdin?.writable) {
      proc.stdin.write(prompt + '\n');
    }
  };

  return emitter;
}

/**
 * Map a Codex JSON event to our unified AgentMessage format.
 */
function mapCodexEvent(event: any): AgentMessage | null {
  const now = Date.now();

  // Message event with role
  if (event.type === 'message' || event.role) {
    const role = event.role ?? 'assistant';

    // Text content
    if (typeof event.content === 'string') {
      return {
        type: 'text',
        role,
        content: event.content,
        timestamp: now,
      };
    }

    // Structured content blocks
    if (Array.isArray(event.content)) {
      const textParts = event.content
        .filter((b: any) => b.type === 'text' || b.type === 'output_text')
        .map((b: any) => b.text ?? b.output_text ?? '')
        .join('');

      if (textParts) {
        return {
          type: 'text',
          role,
          content: textParts,
          timestamp: now,
        };
      }
    }
  }

  // Function/tool call
  if (event.type === 'function_call' || event.type === 'tool_call') {
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Calling: ${event.name ?? event.function?.name ?? 'unknown'}`,
      timestamp: now,
      toolName: event.name ?? event.function?.name,
      toolInput: event.arguments ? tryParseJson(event.arguments) : (event.input ?? {}),
      toolCallId: event.call_id ?? event.id,
    };
  }

  // Function/tool output
  if (event.type === 'function_call_output' || event.type === 'tool_result') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? ''),
      timestamp: now,
      toolCallId: event.call_id ?? event.tool_use_id,
      isError: event.is_error ?? false,
    };
  }

  // Completion / result summary
  if (event.type === 'result' || event.type === 'completion') {
    return {
      type: 'result',
      role: 'assistant',
      content: event.result ?? event.text ?? '',
      timestamp: now,
      costUsd: event.cost_usd,
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

function tryParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}
