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
import { classifySpawnError, attachChildStdinErrorHandler, safeWriteToChildStdin } from '../process-utils';
import {
  extractMcpToolBaseName as _extractMcpToolBaseName,
  isQuestionToolName as _isQuestionToolName,
  isInteractiveToolName as _isInteractiveToolName,
  normalizeClaudeQuestions as _normalizeClaudeQuestions,
  mapClaudeEffort as _mapClaudeEffort,
} from './claude-utils';
import { repairSessionQueue } from './session-repair';

export const CLAUDE_STARTUP_TIMEOUT_MS = 20_000;

/**
 * Map a Claude CLI exit code + stderr into a user-friendly error message.
 */
function classifyClaudeExit(code: number | null, stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('rate limit') || s.includes('rate_limit')) {
    return 'Rate limited by Anthropic API. Wait a few minutes or switch to a different model.';
  }
  if (s.includes('authentication') || s.includes('unauthorized') || s.includes('api key')) {
    return 'Authentication failed. Run "claude login" in your terminal.';
  }
  if (s.includes('context window') || s.includes('context length') || s.includes('too many tokens')) {
    return 'Context window exceeded. Start a new session or use a model with larger context.';
  }
  if (s.includes('econnrefused') || s.includes('enotfound') || s.includes('network')) {
    return 'Network connectivity issue. Check your internet connection.';
  }
  if (code === 137 || code === 9) {
    return 'Process was killed (likely out of memory). Try reducing the scope of your request.';
  }
  if (code === 143 || code === 15) {
    return 'Process was terminated.';
  }
  // Show last meaningful stderr lines for unknown errors
  const lines = stderr.split('\n').filter(l => l.trim()).slice(-3);
  const hint = lines.length > 0 ? `: ${lines.join(' | ')}` : '';
  return `Claude exited with code ${code}${hint}`;
}

// Session queue repair utilities are now in session-repair.ts

/**
 * Spawn a Claude Code CLI subprocess and parse its NDJSON stream output.
 */
export function spawnClaude(options: SpawnOptions): AgentHandle {
  // Proactively repair orphaned queue entries before spawning to prevent
  // "Session ID already in use" errors from lingering after killed processes.
  if (options.resumeSessionId && !options.sshHost) {
    repairSessionQueue(options.resumeSessionId, options.cwd);
  }

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
  attachChildStdinErrorHandler(proc, 'claude');

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'claude-code';

  let stopped = false;
  let finished = false;
  let timeoutError: string | undefined;
  let shutdownPromise: Promise<void> | null = null;
  let sessionIdConflict = false;

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
  const pendingAgentNamesByParentTool = new Map<string, string>();
  const parentToolToSubagent = new Map<string, string>();
  const startedSubagentIds = new Set<string>();
  const finishedSubagentIds = new Set<string>();
  const subagentNames = new Map<string, string>();

  const emitSubagentLifecycle = (opts: {
    subagentId: string;
    subagentName: string;
    status: 'spawning' | 'done' | 'error';
  }) => {
    if (opts.status === 'spawning') {
      if (startedSubagentIds.has(opts.subagentId)) return;
      startedSubagentIds.add(opts.subagentId);
    } else {
      if (finishedSubagentIds.has(opts.subagentId)) return;
      finishedSubagentIds.add(opts.subagentId);
    }

    emitMessage({
      type: 'status',
      role: 'system',
      content: opts.status === 'spawning'
        ? opts.subagentName
        : opts.status === 'error'
          ? `${opts.subagentName} failed`
          : `${opts.subagentName} finished`,
      timestamp: Date.now(),
      statusKind: opts.status === 'spawning' ? 'spawn' : 'progress',
      subagentId: opts.subagentId,
      subagentName: opts.subagentName,
      subagentStatus: opts.status,
    });
  };

  const deriveSubagentName = (opts: {
    subagentId: string;
    parentToolCallId?: string;
    explicitName?: string;
    promptHint?: string;
  }): string => {
    const existing = subagentNames.get(opts.subagentId);
    if (existing) return existing;

    const fromParent = opts.parentToolCallId
      ? pendingAgentNamesByParentTool.get(opts.parentToolCallId)
      : undefined;
    const candidate = opts.explicitName ?? fromParent ?? opts.promptHint ?? `Subagent ${opts.subagentId.slice(0, 8)}`;
    const singleLine = candidate.split('\n')[0]?.trim() ?? candidate.trim();
    const clipped = singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
    const resolved = clipped || `Subagent ${opts.subagentId.slice(0, 8)}`;
    subagentNames.set(opts.subagentId, resolved);
    return resolved;
  };

  const emitWrappedSubagentProgress = (event: Record<string, any>): boolean => {
    const progressPayload = unwrapClaudeAgentProgress(event);
    if (!progressPayload) return false;

    const subagentId = progressPayload.subagentId;
    if (!subagentId) {
      const nested = progressPayload.messageEvent;
      if (!nested) return true;
      const mapped = mapClaudeEvent(nested);
      if (!mapped) return true;
      const msgs = Array.isArray(mapped) ? mapped : [mapped];
      for (const msg of msgs) {
        if (msg.type === 'tool_call' && msg.toolCallId && isAgentToolName(msg.toolName)) {
          pendingAgentNamesByParentTool.set(msg.toolCallId, extractAgentSubagentName(msg.toolInput));
        }
        emitMessage(msg);
      }
      return true;
    }

    if (progressPayload.parentToolCallId) {
      parentToolToSubagent.set(progressPayload.parentToolCallId, subagentId);
    }

    const subagentName = deriveSubagentName({
      subagentId,
      parentToolCallId: progressPayload.parentToolCallId,
      explicitName: progressPayload.subagentNameHint,
      promptHint: progressPayload.promptHint,
    });

    emitSubagentLifecycle({ subagentId, subagentName, status: 'spawning' });

    if (progressPayload.messageEvent) {
      const mapped = mapClaudeEvent(progressPayload.messageEvent);
      if (mapped) {
        const msgs = Array.isArray(mapped) ? mapped : [mapped];
        for (const msg of msgs) {
          if (msg.type === 'tool_call' && msg.toolCallId && isAgentToolName(msg.toolName)) {
            pendingAgentNamesByParentTool.set(msg.toolCallId, extractAgentSubagentName(msg.toolInput));
          }
          emitMessage({
            ...msg,
            subagentId,
            subagentName,
            ...(msg.subagentStatus ? {} : { subagentStatus: 'running' as const }),
          });
        }
      }
    }

    if (progressPayload.isTerminal) {
      emitSubagentLifecycle({
        subagentId,
        subagentName,
        status: progressPayload.hasError ? 'error' : 'done',
      });
    }

    return true;
  };

  const emitMapped = (event: Record<string, any>) => {
    // Wrapped subagent progress stream from Claude's Agent tool
    if (emitWrappedSubagentProgress(event)) {
      return;
    }

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
        if (isAgentToolName(buf.name)) {
          pendingAgentNamesByParentTool.set(buf.id, extractAgentSubagentName(parsedInput));
        }
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
          if (isAgentToolName(m.toolName)) {
            pendingAgentNamesByParentTool.set(m.toolCallId, extractAgentSubagentName(m.toolInput));
          }
        }
        if (m.type === 'tool_result' && m.toolCallId) {
          const subagentId = parentToolToSubagent.get(m.toolCallId);
          if (subagentId) {
            const subagentName = subagentNames.get(subagentId) ?? `Subagent ${subagentId.slice(0, 8)}`;
            emitSubagentLifecycle({
              subagentId,
              subagentName,
              status: m.isError ? 'error' : 'done',
            });
            parentToolToSubagent.delete(m.toolCallId);
          }
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

    // Detect "Session ID already in use" — will retry in close handler
    if (text.includes('already in use') && options.resumeSessionId && !sessionIdConflict) {
      sessionIdConflict = true;
      return;
    }

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
    // Retry transparently when session lock collision is detected
    if (sessionIdConflict && !stopped) {
      watchdog.clear();

      // Attempt a more aggressive repair now that we know the session is locked,
      // then retry WITH the session ID first before giving up on native resume.
      if (options.resumeSessionId) {
        repairSessionQueue(options.resumeSessionId, options.cwd);
      }

      // Build the retry options: inject conversation context if native resume
      // must be dropped so the agent still knows what happened before.
      const retryOptions = { ...options };
      if (options.fallbackContext) {
        retryOptions.resumeSessionId = undefined;
        retryOptions.prompt = [
          'You are continuing a previous conversation. Here is the context:',
          '',
          options.fallbackContext,
          '',
          '## Current request',
          options.prompt,
        ].join('\n');
        emitMessage({
          type: 'status',
          role: 'system',
          statusKind: 'progress',
          content: 'Session lock detected — continuing with conversation context...',
          timestamp: Date.now(),
        });
      } else {
        retryOptions.resumeSessionId = undefined;
        emitMessage({
          type: 'status',
          role: 'system',
          statusKind: 'progress',
          content: 'Session lock detected — retrying with fresh session...',
          timestamp: Date.now(),
        });
      }

      const retryHandle = spawnClaude(retryOptions);
      // Forward all events from retry to the original emitter
      retryHandle.on('message', (msg: AgentMessage) => emitter.emit('message', msg));
      retryHandle.on('done', (result: { code: number | null; error?: string }) => emitter.emit('done', result));
      retryHandle.on('session-meta', (meta: unknown) => emitter.emit('session-meta', meta));
      // Rewire control methods to the retry handle
      emitter.stop = () => retryHandle.stop();
      emitter.approve = (id: string) => retryHandle.approve(id);
      emitter.deny = (id: string) => retryHandle.deny(id);
      emitter.steer = (p: string, i?: string[]) => retryHandle.steer(p, i);
      emitter.answerQuestion = (id: string, r: string) => retryHandle.answerQuestion(id, r);
      emitter.isAlive = () => retryHandle.isAlive();
      return;
    }

    if (buffer.trim()) {
      const event = parseClaudeEvent(buffer);
      if (event) {
        emitMapped(event);
      }
    }

    const exitError = timeoutError ?? (stopped || code === 0 || code === null
      ? undefined
      : classifyClaudeExit(code, lastStderrError));

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

  emitter.isAlive = () => !finished && !stopped && proc.stdin?.writable === true;

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

  safeWriteToChildStdin(proc, JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  }) + '\n', 'claude');
}

function writeClaudeControlResponse(
  proc: ChildProcess,
  requestId: string,
  response: { behavior: 'allow' } | { behavior: 'deny'; message: string },
): void {
  if (!proc.stdin?.writable) return;

  safeWriteToChildStdin(proc, JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response,
    },
  }) + '\n', 'claude');
}

function writeClaudeQuestionResponse(proc: ChildProcess, requestId: string, response: string): void {
  if (!proc.stdin?.writable) return;

  safeWriteToChildStdin(proc, JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: requestId,
        content: `User has answered your questions: ${response}. You can now continue with the user's answers in mind.`,
      }],
    },
  }) + '\n', 'claude');
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

const mapClaudeEffort = _mapClaudeEffort;

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

function unwrapClaudeAgentProgress(event: Record<string, any>): {
  subagentId?: string;
  parentToolCallId?: string;
  messageEvent?: Record<string, any>;
  promptHint?: string;
  subagentNameHint?: string;
  isTerminal: boolean;
  hasError: boolean;
} | null {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }

  let payload: Record<string, any> = event;
  let envelopeType = readClaudeString(event.type);
  if (
    envelopeType === 'progress'
    && event.data
    && typeof event.data === 'object'
    && !Array.isArray(event.data)
  ) {
    payload = event.data as Record<string, any>;
    envelopeType = readClaudeString((payload as any).type, envelopeType);
  }

  const lowered = envelopeType.toLowerCase();
  if (!(lowered === 'agent_progress' || lowered.startsWith('agent_'))) {
    return null;
  }

  const rawMessage = payload.message;
  const messageEvent = rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage)
    ? rawMessage as Record<string, any>
    : undefined;

  const subagentId = readClaudeString(
    payload.agentId,
    payload.agent_id,
    event.agentId,
    event.agent_id,
  );
  const parentToolCallId = readClaudeString(
    payload.parentToolUseID,
    payload.parentToolUseId,
    payload.parent_tool_use_id,
    event.parentToolUseID,
    event.parentToolUseId,
    event.parent_tool_use_id,
  );
  const promptHint = readClaudeString(payload.prompt, event.prompt);
  const subagentNameHint = readClaudeString(
    payload.name,
    payload.subagentName,
    payload.subagent_name,
    event.subagentName,
    event.subagent_name,
  );
  const nestedType = readClaudeString(messageEvent?.type, messageEvent?.event, messageEvent?.subtype).toLowerCase();
  const isTerminal = /agent_(done|completed|complete|finished|error|failed)/.test(lowered)
    || nestedType === 'result'
    || nestedType === 'error';
  const hasError = /error|failed/.test(lowered) || nestedType === 'error';

  return {
    ...(subagentId ? { subagentId } : {}),
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(messageEvent ? { messageEvent } : {}),
    ...(promptHint ? { promptHint } : {}),
    ...(subagentNameHint ? { subagentNameHint } : {}),
    isTerminal,
    hasError,
  };
}

function isAgentToolName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().toLowerCase() === 'agent';
}

function extractAgentSubagentName(input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return 'Subagent';
  const description = readClaudeString((input as any).description);
  if (description) return description;
  const prompt = readClaudeString((input as any).prompt);
  return prompt || 'Subagent';
}

function readClaudeString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
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

// Re-export shared utilities for backward compatibility
const extractMcpToolBaseName = _extractMcpToolBaseName;
const isQuestionToolName = _isQuestionToolName;
const normalizeClaudeQuestions = _normalizeClaudeQuestions;
export const isInteractiveToolName = _isInteractiveToolName;

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

// normalizeClaudeQuestions is now in claude-utils.ts

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
