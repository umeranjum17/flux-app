import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage, QuestionField, PLAN_FORMAT_PREAMBLE } from './types';
import {
  spawnAgentProcess,
  createStartupWatchdog,
  filterStderrNoise,
  isMeaningfulMessage,
  terminateAgentProcess,
} from './spawn-utils';
import { classifySpawnError } from '../process-utils';

export const CLAUDE_STARTUP_TIMEOUT_MS = 20_000;

/**
 * Spawn a Claude Code CLI subprocess and parse its NDJSON stream output.
 */
export function spawnClaude(options: SpawnOptions): AgentHandle {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--permission-prompt-tool', 'stdio',
    '--no-chrome',
    '--include-partial-messages',
    '--verbose',
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.dangerouslyBypassPermissions) {
    args.push('--dangerously-skip-permissions');
  } else if (options.mode === 'plan') {
    args.push('--permission-mode', 'plan');
  }

  if (options.thinking) {
    args.push('--effort', mapClaudeEffort(options.thinking));
  }

  if (options.resumeSessionId) {
    args.push('--session-id', options.resumeSessionId);
  }

  const proc: ChildProcess = spawnAgentProcess({
    command: options.binaryPath || 'claude',
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'claude-code';

  let stopped = false;
  let finished = false;
  let timeoutError: string | undefined;
  let shutdownPromise: Promise<void> | null = null;

  const requestShutdown = () => {
    shutdownPromise ??= terminateAgentProcess(proc);
    return shutdownPromise;
  };

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    watchdog.clear();
    emitter.emit('done', result);
  };

  const watchdog = createStartupWatchdog({
    timeoutMs: CLAUDE_STARTUP_TIMEOUT_MS,
    label: 'Claude',
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
    cwd: options.cwd,
    onTimeout: (error) => {
      if (finished || stopped) return;
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

  if (options.sshHost) {
    setTimeout(() => {
      emitMessage({
        type: 'status',
        role: 'system',
        statusKind: 'spawn',
        content: `[SSH] Spawning claude on ${options.sshHost} (cwd: ${options.remoteCwd ?? options.cwd})`,
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

  proc.stdout?.on('data', () => watchdog.resetProgress());

  let buffer = '';
  const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

  // Streaming tool input accumulation (Phase 1.4)
  const toolInputBuffers = new Map<number, { name: string; id: string; json: string }>();
  const emittedToolCallIds = new Set<string>();

  const emitMapped = (event: Record<string, any>) => {
    // Handle content_block_start for tool_use — begin streaming accumulation
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const block = event.content_block;
      if (isQuestionToolName(block.name)) {
        // Let mapClaudeEvent handle question tool_use blocks directly
        const result = mapClaudeEvent(event);
        if (result) {
          const msgs = Array.isArray(result) ? result : [result];
          for (const m of msgs) emitMessage(m);
        }
      } else {
        // Start accumulating tool input
        toolInputBuffers.set(event.index ?? 0, {
          name: block.name,
          id: block.id,
          json: '',
        });
      }
      return;
    }

    // Handle input_json_delta — accumulate streaming tool input fragments
    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const idx = event.index ?? 0;
      const buf = toolInputBuffers.get(idx);
      if (buf) {
        buf.json += event.delta.partial_json ?? '';
      }
      return;
    }

    // Handle content_block_stop — emit complete tool_call with accumulated input
    if (event.type === 'content_block_stop') {
      const idx = event.index ?? 0;
      const buf = toolInputBuffers.get(idx);
      if (buf && !emittedToolCallIds.has(buf.id)) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = buf.json ? JSON.parse(buf.json) : {};
        } catch {
          parsedInput = { raw: buf.json };
        }

        emittedToolCallIds.add(buf.id);
        emitMessage({
          type: 'tool_call',
          role: 'assistant',
          content: `Using tool: ${buf.name}`,
          timestamp: Date.now(),
          toolName: buf.name,
          toolInput: parsedInput,
          toolCallId: buf.id,
        });
        toolInputBuffers.delete(idx);
      }
      return;
    }

    const result = mapClaudeEvent(event);
    if (result) {
      const msgs = Array.isArray(result) ? result : [result];
      for (const m of msgs) {
        // Deduplicate tool_call emissions
        if (m.type === 'tool_call' && m.toolCallId && emittedToolCallIds.has(m.toolCallId)) {
          continue;
        }
        if (m.type === 'tool_call' && m.toolCallId) {
          emittedToolCallIds.add(m.toolCallId);
        }
        emitMessage(m);
      }
    }
  };

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
      const event = parseClaudeEvent(line);
      if (!event) continue;

      if (event.session_id || event.sessionId) {
        emitter.emit('session-meta', { id: event.session_id ?? event.sessionId });
      }

      emitMapped(event);
    }
  });

  let lastStderrError = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;

    const actionable = filterStderrNoise(text);
    if (!actionable) return;

    lastStderrError = actionable;
    emitMessage({
      type: 'error',
      role: 'system',
      content: actionable,
      timestamp: Date.now(),
    });
  });

  proc.on('close', (code: number | null) => {
    if (buffer.trim()) {
      const event = parseClaudeEvent(buffer);
      if (event) {
        emitMapped(event);
      }
    }

    const exitError = timeoutError ?? (stopped || code === 0 || code === null
      ? undefined
      : lastStderrError
        ? `Claude exited with code ${code}: ${lastStderrError}`
        : `Claude exited with code ${code}`);

    finish({
      code,
      ...(exitError ? { error: exitError } : {}),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}
    const info = classifySpawnError(err, { command: 'claude', sshHost: options.sshHost });
    const content = `Failed to start Claude: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`;
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
    if (finished) {
      exitPromise = Promise.resolve();
      return exitPromise;
    }
    exitPromise = requestShutdown();
    return exitPromise;
  };

  emitter.approve = (requestId: string) => {
    writeClaudeControlResponse(proc, requestId, { behavior: 'allow' });
  };

  emitter.deny = (requestId: string) => {
    writeClaudeControlResponse(proc, requestId, {
      behavior: 'deny',
      message: 'User denied permission',
    });
  };

  emitter.steer = (prompt: string, images?: string[]) => {
    writeClaudeUserMessage(proc, prompt, images);
  };

  emitter.answerQuestion = (requestId: string, response: string) => {
    writeClaudeQuestionResponse(proc, requestId, response);
  };

  const promptText = options.mode === 'plan'
    ? `${PLAN_FORMAT_PREAMBLE}\n\n${options.prompt}`
    : options.prompt;
  writeClaudeUserMessage(proc, promptText, options.images);

  return emitter;
}

function parseClaudeEvent(line: string): Record<string, any> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // Ignore malformed lines.
  }

  return null;
}

function writeClaudeUserMessage(proc: ChildProcess, prompt: string, images?: string[]): void {
  if (!proc.stdin?.writable) return;

  const content: Array<Record<string, unknown>> = [];
  if (prompt.trim()) {
    content.push({ type: 'text', text: prompt });
  }

  for (const image of images ?? []) {
    const block = toClaudeImageBlock(image);
    if (block) {
      content.push(block);
    }
  }

  if (content.length === 0) return;

  proc.stdin.write(JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  }) + '\n');
}

function writeClaudeControlResponse(
  proc: ChildProcess,
  requestId: string,
  response: { behavior: 'allow' } | { behavior: 'deny'; message: string },
): void {
  if (!proc.stdin?.writable) return;

  proc.stdin.write(JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response,
    },
  }) + '\n');
}

function writeClaudeQuestionResponse(proc: ChildProcess, requestId: string, response: string): void {
  if (!proc.stdin?.writable) return;

  proc.stdin.write(JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: requestId,
        content: `User has answered your questions: ${response}. You can now continue with the user's answers in mind.`,
      }],
    },
  }) + '\n');
}

function toClaudeImageBlock(image: string): Record<string, unknown> | null {
  const match = image.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;

  const [, mediaType, data] = match;
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data,
    },
  };
}

function mapClaudeEffort(thinking: NonNullable<SpawnOptions['thinking']>): 'low' | 'medium' | 'high' {
  if (thinking === 'xhigh') return 'high';
  return thinking;
}

/**
 * Normalize tool result content from Claude's structured format to a plain string.
 * Claude tool results may contain `[{type: "text", text: "..."}]` arrays.
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text);
    if (texts.length > 0) return texts.join('\n');
  }
  if (content == null) return '';
  try { return JSON.stringify(content); } catch { return String(content); }
}

/**
 * Map a Claude stream-json event to our unified AgentMessage format.
 * May return an array when a single event contains multiple content blocks.
 */
function mapClaudeEvent(event: Record<string, any>): AgentMessage | AgentMessage[] | null {
  const now = Date.now();

  if (event.type === 'assistant' && event.message?.content) {
    const blocks: any[] = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
    const messages: AgentMessage[] = [];
    let textParts: string[] = [];

    for (const block of blocks) {
      if (block.type === 'tool_use' && isQuestionToolName(block.name)) {
        // Flush accumulated text first
        if (textParts.length > 0) {
          messages.push({ type: 'text', role: 'assistant', content: textParts.join(''), timestamp: now });
          textParts = [];
        }
        const q = mapClaudeQuestionRequest(block, now);
        if (q) messages.push(q);
      } else if (block.type === 'tool_use') {
        if (textParts.length > 0) {
          messages.push({ type: 'text', role: 'assistant', content: textParts.join(''), timestamp: now });
          textParts = [];
        }
        messages.push({
          type: 'tool_call',
          role: 'assistant',
          content: `Using tool: ${block.name}`,
          timestamp: now,
          toolName: block.name,
          toolInput: block.input ?? {},
          toolCallId: block.id,
        });
      } else if (block.type === 'text') {
        textParts.push(block.text ?? '');
      } else if (block.type === 'thinking') {
        if (textParts.length > 0) {
          messages.push({ type: 'text', role: 'assistant', content: textParts.join(''), timestamp: now });
          textParts = [];
        }
        messages.push({ type: 'thinking', role: 'assistant', content: block.thinking ?? '', timestamp: now });
      }
    }

    // Flush remaining text
    if (textParts.length > 0) {
      messages.push({ type: 'text', role: 'assistant', content: textParts.join(''), timestamp: now });
    }

    if (messages.length === 0) return null;
    if (messages.length === 1) return messages[0];
    return messages;
  }

  // Handle user events with tool_result content blocks (wrapped tool results)
  if (event.type === 'user' && event.message?.content) {
    const blocks = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          role: 'tool',
          content: normalizeToolResultContent(block.content),
          timestamp: now,
          toolCallId: block.tool_use_id,
          isError: block.is_error ?? false,
        };
      }
    }
  }

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

    // input_json_delta is handled by spawnClaude's streaming accumulation, not here
  }

  if (event.type === 'tool_use' || (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')) {
    const tool = event.type === 'tool_use' ? event : event.content_block;
    if (isQuestionToolName(tool.name)) {
      return mapClaudeQuestionRequest(tool, now);
    }
    // content_block_start for tool_use is handled by streaming accumulation in spawnClaude
    // Only emit here for non-streaming top-level tool_use events
    if (event.type === 'tool_use') {
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
    return null;
  }

  if (event.type === 'tool_result') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: normalizeToolResultContent(event.content),
      timestamp: now,
      toolCallId: event.tool_use_id,
      isError: event.is_error ?? false,
    };
  }

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

  if (event.type === 'result') {
    return {
      type: 'result',
      role: 'assistant',
      content: event.result ?? event.text ?? '',
      timestamp: now,
      costUsd: event.cost_usd ?? event.usage?.cost_usd ?? event.total_cost_usd ?? event.total_cost,
      inputTokens: event.usage?.input_tokens ?? event.input_tokens
        ?? (typeof event.usage?.cache_read_input_tokens === 'number'
          ? (event.usage.cache_read_input_tokens + (event.usage.cache_creation_input_tokens ?? 0))
          : undefined),
      outputTokens: event.usage?.output_tokens ?? event.output_tokens,
      durationMs: event.duration_ms ?? event.duration_api_ms,
    };
  }

  if (event.type === 'rate_limit_event' && event.rate_limit_info) {
    const info = event.rate_limit_info;
    const utilization = typeof info.utilization === 'number'
      ? info.utilization
      : typeof info.percentCapacity === 'number'
        ? info.percentCapacity / 100
        : typeof info.percent_capacity === 'number'
          ? info.percent_capacity / 100
          : 0;

    return {
      type: 'rate_limit',
      role: 'system',
      content: `Claude rate limit ${Math.round(utilization * 100)}%`,
      timestamp: now,
      rateLimitInfo: { ...info, utilization },
    };
  }

  if (event.type === 'system') {
    return mapClaudeSystemEvent(event, now);
  }

  if (event.type === 'error') {
    return {
      type: 'error',
      role: 'system',
      content: event.message ?? event.error ?? 'Claude reported an error',
      timestamp: now,
    };
  }

  return null;
}

function isQuestionToolName(name: unknown): boolean {
  return name === 'AskUserQuestion' || name === 'request_user_input';
}

function mapClaudeQuestionRequest(tool: Record<string, any>, timestamp: number): AgentMessage | null {
  const input = tool.input && typeof tool.input === 'object' ? tool.input : {};
  const questions = normalizeClaudeQuestions(input);
  if (questions.length === 0) {
    return null;
  }

  const firstQuestion = questions[0];
  const content = questions.length === 1
    ? firstQuestion.question
    : `${firstQuestion.question}\n\n${questions.length - 1} more question${questions.length > 2 ? 's' : ''} pending`;

  return {
    type: 'question_request',
    role: 'assistant',
    content,
    timestamp,
    requestId: tool.id ?? tool.request_id ?? `question-${timestamp}`,
    questions,
    options: firstQuestion.options,
    allowFreeform: questions.some((question) => question.allowFreeform),
    placeholder: firstQuestion.placeholder,
  };
}

function normalizeClaudeQuestions(input: Record<string, any>): QuestionField[] {
  const rawQuestions = Array.isArray(input.questions)
    ? input.questions
    : typeof input.question === 'string'
      ? [input]
      : [];

  return rawQuestions
    .filter((question): question is Record<string, any> => !!question && typeof question === 'object' && !Array.isArray(question))
    .map((question) => {
      const options = Array.isArray(question.options)
        ? question.options
          .filter((option): option is Record<string, any> => !!option && typeof option === 'object' && !Array.isArray(option))
          .map((option) => ({
            label: typeof option.label === 'string' ? option.label : String(option.value ?? ''),
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
            ...(typeof option.value === 'string' ? { value: option.value } : {}),
          }))
          .filter((option) => option.label.trim().length > 0)
        : undefined;
      const allowFreeform = typeof question.allowFreeform === 'boolean'
        ? question.allowFreeform
        : typeof question.allow_freeform === 'boolean'
          ? question.allow_freeform
          : !options || options.length === 0;

      return {
        ...(typeof question.header === 'string' ? { header: question.header } : {}),
        question: typeof question.question === 'string' ? question.question : String(question.prompt ?? ''),
        ...(options?.length ? { options } : {}),
        allowFreeform,
        ...(typeof question.placeholder === 'string' ? { placeholder: question.placeholder } : {}),
        ...(typeof question.multiSelect === 'boolean' ? { multiSelect: question.multiSelect } : {}),
      };
    })
    .filter((question) => question.question.trim().length > 0);
}

function mapClaudeSystemEvent(event: Record<string, any>, timestamp: number): AgentMessage | null {
  if (event.subtype === 'hook_started') {
    const hookEvent = event.hook_event ?? event.hookEvent;
    const hookName = event.hook_name ?? event.hookName;

    return {
      type: 'status',
      role: 'system',
      statusKind: hookEvent === 'SessionStart' ? 'startup' : 'diagnostic',
      content: hookEvent === 'SessionStart'
        ? 'Initializing Claude session'
        : hookName
          ? `Running hook: ${hookName}`
          : 'Running Claude hook',
      timestamp,
    };
  }

  if (event.subtype === 'hook_response') {
    const hookEvent = event.hook_event ?? event.hookEvent;
    const hookName = event.hook_name ?? event.hookName;

    if (hookEvent === 'SessionStart') {
      return null;
    }

    return {
      type: 'status',
      role: 'system',
      statusKind: 'diagnostic',
      content: hookName
        ? `Completed hook: ${hookName}`
        : 'Claude hook completed',
      timestamp,
    };
  }

  if (typeof event.message === 'string' && event.message.trim()) {
    return {
      type: 'status',
      role: 'system',
      statusKind: 'diagnostic',
      content: event.message.trim(),
      timestamp,
    };
  }

  if (typeof event.content === 'string' && event.content.trim()) {
    return {
      type: 'status',
      role: 'system',
      statusKind: 'diagnostic',
      content: event.content.trim(),
      timestamp,
    };
  }

  return null;
}
