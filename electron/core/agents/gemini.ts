import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { createCliAgentHandle } from './cli-agent';
import { safeWriteToChildStdin } from '../process-utils';

/**
 * Spawn a Gemini CLI subprocess and parse its NDJSON stream output.
 */
export function spawnGemini(options: SpawnOptions): AgentHandle {
  return createCliAgentHandle(options, {
    agentId: 'gemini',
    label: 'Gemini',
    defaultCommand: 'gemini',
    startupTimeoutMs: 20_000,

    buildArgs(opts) {
      const args: string[] = ['--output-format', 'stream-json'];
      if (opts.model) {
        args.push('--model', opts.model);
      }
      args.push(opts.prompt);
      return args;
    },

    mapEvent: mapGeminiEvent,

    classifyExit(code) {
      return `Gemini exited with code ${code}`;
    },

    controls: {
      approve(proc, requestId) {
        safeWriteToChildStdin(proc, JSON.stringify({ type: 'approve', requestId }) + '\n', 'gemini');
      },
      deny(proc, requestId) {
        safeWriteToChildStdin(proc, JSON.stringify({ type: 'deny', requestId }) + '\n', 'gemini');
      },
      steer(proc, prompt, images) {
        const payload: Record<string, unknown> = { type: 'user_message', content: prompt };
        if (images?.length) {
          payload.images = images;
        }
        safeWriteToChildStdin(proc, JSON.stringify(payload) + '\n', 'gemini');
      },
      answerQuestion(proc, _requestId, response) {
        const payload = { type: 'user_message', content: response };
        safeWriteToChildStdin(proc, JSON.stringify(payload) + '\n', 'gemini');
      },
    },

    hooks: {
      // Gemini also resets watchdog on stderr
      onAfterSpawn(proc, ctx) {
        proc.stderr?.on('data', () => ctx.watchdog.resetProgress());
      },
    },
  });
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
