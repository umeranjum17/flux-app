import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';

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

  const proc: ChildProcess = spawn('gemini', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'gemini';
  let stopped = false;

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
        // Plain text fallback
        emitter.emit('message', {
          type: 'text',
          role: 'assistant',
          content: trimmed,
          timestamp: Date.now(),
        } satisfies AgentMessage);
        continue;
      }

      const message = mapGeminiEvent(event);
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
        const message = mapGeminiEvent(event);
        if (message) {
          emitter.emit('message', message);
        }
      } catch {
        // ignore
      }
    }
    emitter.emit('done', {
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Gemini exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const msg: AgentMessage = {
      type: 'error',
      role: 'system',
      content: `Failed to spawn gemini: ${err.message}`,
      timestamp: Date.now(),
    };
    emitter.emit('message', msg);
    emitter.emit('done', { code: 1, error: err.message });
  });

  emitter.stop = () => {
    stopped = true;
    proc.kill('SIGTERM');
  };

  emitter.approve = (requestId: string) => {
    if (proc.stdin?.writable) {
      proc.stdin.write(JSON.stringify({ type: 'approve', requestId }) + '\n');
    }
  };

  emitter.deny = (requestId: string) => {
    if (proc.stdin?.writable) {
      proc.stdin.write(JSON.stringify({ type: 'deny', requestId }) + '\n');
    }
  };

  emitter.steer = (prompt: string, images?: string[]) => {
    if (proc.stdin?.writable) {
      const payload: Record<string, unknown> = { type: 'user_message', content: prompt };
      if (images?.length) {
        payload.images = images;
      }
      proc.stdin.write(JSON.stringify(payload) + '\n');
    }
  };

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
