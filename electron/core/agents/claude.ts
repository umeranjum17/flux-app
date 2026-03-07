import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';

/**
 * Spawn a Claude Code CLI subprocess and parse its NDJSON stream output.
 */
export function spawnClaude(options: SpawnOptions): AgentHandle {
  const args: string[] = [
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.mode === 'plan') {
    args.push('--permission-mode', 'plan');
  }

  if (options.thinking) {
    args.push('--thinking', options.thinking);
  }

  if (options.sessionId) {
    args.push('--session-id', options.sessionId);
  }

  // Prompt as last positional argument
  args.push(options.prompt);

  const proc: ChildProcess = spawn('claude', args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'claude-code';
  let stopped = false;

  let buffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    // Keep the last partial line in the buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        // Not valid JSON, skip
        continue;
      }

      const message = mapClaudeEvent(event);
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
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const message = mapClaudeEvent(event);
        if (message) {
          emitter.emit('message', message);
        }
      } catch {
        // ignore
      }
    }
    emitter.emit('done', {
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Claude exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const msg: AgentMessage = {
      type: 'error',
      role: 'system',
      content: `Failed to spawn claude: ${err.message}`,
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
    // Write approval JSON to stdin for permission requests
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
 * Map a Claude stream-json event to our unified AgentMessage format.
 */
function mapClaudeEvent(event: any): AgentMessage | null {
  const now = Date.now();

  // Assistant text content
  if (event.type === 'assistant' && event.message?.content) {
    const textBlock = Array.isArray(event.message.content)
      ? event.message.content.find((b: any) => b.type === 'text')
      : null;

    if (textBlock) {
      return {
        type: 'text',
        role: 'assistant',
        content: textBlock.text ?? '',
        timestamp: now,
      };
    }

    // Thinking blocks
    const thinkingBlock = Array.isArray(event.message.content)
      ? event.message.content.find((b: any) => b.type === 'thinking')
      : null;

    if (thinkingBlock) {
      return {
        type: 'thinking',
        role: 'assistant',
        content: thinkingBlock.thinking ?? '',
        timestamp: now,
      };
    }
  }

  // Content block delta (streaming text)
  if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'text_delta') {
      return {
        type: 'text',
        role: 'assistant',
        content: event.delta.text ?? '',
        timestamp: now,
      };
    }
    if (event.delta?.type === 'thinking_delta') {
      return {
        type: 'thinking',
        role: 'assistant',
        content: event.delta.thinking ?? '',
        timestamp: now,
      };
    }
  }

  // Tool use
  if (event.type === 'tool_use' || event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    const tool = event.type === 'tool_use' ? event : event.content_block;
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Using tool: ${tool.name}`,
      timestamp: now,
      toolName: tool.name,
      toolInput: tool.input ?? {},
      toolCallId: tool.id,
    };
  }

  // Tool result
  if (event.type === 'tool_result') {
    const content = typeof event.content === 'string'
      ? event.content
      : JSON.stringify(event.content ?? '');

    return {
      type: 'tool_result',
      role: 'tool',
      content,
      timestamp: now,
      toolCallId: event.tool_use_id,
      isError: event.is_error ?? false,
    };
  }

  // Permission request (Claude Code specific)
  if (event.type === 'permission_request') {
    return {
      type: 'permission_request',
      role: 'system',
      content: event.description ?? 'Permission requested',
      timestamp: now,
      requestId: event.request_id,
      toolName: event.tool_name,
      action: event.tool_name,
      filePath: event.file_path,
    };
  }

  // Final result with cost/token info
  if (event.type === 'result') {
    return {
      type: 'result',
      role: 'assistant',
      content: event.result ?? event.text ?? '',
      timestamp: now,
      costUsd: event.cost_usd ?? event.usage?.cost_usd,
      inputTokens: event.usage?.input_tokens ?? event.input_tokens,
      outputTokens: event.usage?.output_tokens ?? event.output_tokens,
      durationMs: event.duration_ms,
    };
  }

  // System-level messages
  if (event.type === 'system' || event.type === 'error') {
    return {
      type: event.type === 'error' ? 'error' : 'text',
      role: 'system',
      content: event.message ?? event.error ?? JSON.stringify(event),
      timestamp: now,
    };
  }

  return null;
}
