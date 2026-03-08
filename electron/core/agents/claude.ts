import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage, QuestionField } from './types';
import { spawnAgentProcess } from './spawn-utils';

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

  if (options.mode === 'plan') {
    args.push('--permission-mode', 'plan');
  }

  if (options.thinking) {
    args.push('--effort', mapClaudeEffort(options.thinking));
  }

  if (options.resumeSessionId) {
    args.push('--session-id', options.resumeSessionId);
  }

  const proc: ChildProcess = spawnAgentProcess({
    command: options.sshHost ? 'claude' : (options.binaryPath || 'claude'),
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'claude-code';

  let stopped = false;
  let finished = false;
  let sawMeaningfulProgress = false;

  const clearStartupWatchdog = (() => {
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      if (finished || stopped || sawMeaningfulProgress) return;

      const target = options.sshHost
        ? `${options.sshHost} (cwd: ${options.remoteCwd ?? options.cwd})`
        : `cwd: ${options.cwd}`;
      const error = options.sshHost
        ? `Claude startup timed out over SSH after ${Math.round(CLAUDE_STARTUP_TIMEOUT_MS / 1000)}s on ${target}`
        : `Claude startup timed out after ${Math.round(CLAUDE_STARTUP_TIMEOUT_MS / 1000)}s (${target})`;

      try { proc.kill('SIGTERM'); } catch {}
      emitMessage({
        type: 'error',
        role: 'system',
        content: error,
        timestamp: Date.now(),
      });
      finish({ code: 1, error });
    }, CLAUDE_STARTUP_TIMEOUT_MS);

    return () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    };
  })();

  const markMeaningfulProgress = () => {
    if (sawMeaningfulProgress) return;
    sawMeaningfulProgress = true;
    clearStartupWatchdog();
  };

  const emitMessage = (message: AgentMessage) => {
    if (isMeaningfulClaudeMessage(message)) {
      markMeaningfulProgress();
    }
    emitter.emit('message', message);
  };

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    clearStartupWatchdog();
    emitter.emit('done', result);
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

  let buffer = '';
  const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

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

      const message = mapClaudeEvent(event);
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
      const event = parseClaudeEvent(buffer);
      if (event) {
        const message = mapClaudeEvent(event);
        if (message) {
          emitMessage(message);
        }
      }
    }

    const exitError = stopped || code === 0 || code === null
      ? undefined
      : `Claude exited with code ${code}`;
    const noResponseError = !stopped && !sawMeaningfulProgress
      ? 'Claude exited before producing a response'
      : undefined;

    finish({
      code,
      ...(exitError ?? noResponseError ? { error: exitError ?? noResponseError } : {}),
    });
  });

  proc.on('error', (err: Error) => {
    try { proc.kill(); } catch {}

    emitMessage({
      type: 'error',
      role: 'system',
      content: `Failed to spawn claude: ${err.message}`,
      timestamp: Date.now(),
    });
    finish({ code: 1, error: err.message });
  });

  emitter.stop = () => {
    stopped = true;
    clearStartupWatchdog();
    proc.kill('SIGTERM');
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

  writeClaudeUserMessage(proc, options.prompt, options.images);

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

function isMeaningfulClaudeMessage(message: AgentMessage): boolean {
  if (
    message.type === 'error' ||
    message.type === 'permission_request' ||
    message.type === 'question_request' ||
    message.type === 'result'
  ) {
    return true;
  }

  if (message.type === 'tool_call') {
    return true;
  }

  if ((message.type === 'text' || message.type === 'thinking') && message.role === 'assistant') {
    return true;
  }

  return false;
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

function filterStderrNoise(text: string): string | null {
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Rust tracing / logging output
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return false;
    if (/^\s*(ERROR|WARN|DEBUG|TRACE|INFO)\s/.test(trimmed)) return false;
    if (/rmcp::/.test(trimmed)) return false;
    // MCP transport noise
    if (/Transport channel closed/i.test(trimmed)) return false;
    if (/transport error/i.test(trimmed)) return false;
    return true;
  });
  return lines.length > 0 ? lines.join('\n') : null;
}

function mapClaudeEffort(thinking: NonNullable<SpawnOptions['thinking']>): 'low' | 'medium' | 'high' {
  if (thinking === 'xhigh') return 'high';
  return thinking;
}

/**
 * Map a Claude stream-json event to our unified AgentMessage format.
 */
function mapClaudeEvent(event: Record<string, any>): AgentMessage | null {
  const now = Date.now();

  if (event.type === 'assistant' && event.message?.content) {
    const questionBlock = Array.isArray(event.message.content)
      ? event.message.content.find((block: any) => block.type === 'tool_use' && isQuestionToolName(block.name))
      : null;

    if (questionBlock) {
      return mapClaudeQuestionRequest(questionBlock, now);
    }

    const textBlock = Array.isArray(event.message.content)
      ? event.message.content.find((block: any) => block.type === 'text')
      : null;

    if (textBlock) {
      return {
        type: 'text',
        role: 'assistant',
        content: textBlock.text ?? '',
        timestamp: now,
      };
    }

    const thinkingBlock = Array.isArray(event.message.content)
      ? event.message.content.find((block: any) => block.type === 'thinking')
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

  if (event.type === 'tool_use' || (event.type === 'content_block_start' && event.content_block?.type === 'tool_use')) {
    const tool = event.type === 'tool_use' ? event : event.content_block;
    if (isQuestionToolName(tool.name)) {
      return mapClaudeQuestionRequest(tool, now);
    }
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
