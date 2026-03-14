import { EventEmitter } from 'events';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHandle, AgentMessage, SpawnOptions, QuestionField } from './types';
import { extractMcpToolBaseName, isInteractiveToolName, normalizeClaudeQuestions } from './claude-utils';

/**
 * Map Flux's ThinkingLevel to SDK effort levels.
 */
function mapEffort(thinking: SpawnOptions['thinking']): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!thinking) return undefined;
  if (thinking === 'xhigh') return 'max';
  return thinking;
}

/**
 * Map Flux's SpawnOptions.mode + permission flags to an SDK permission mode.
 */
function mapPermissionMode(options: SpawnOptions): 'default' | 'plan' | 'bypassPermissions' {
  if (options.mode === 'plan') return 'plan';
  if (options.dangerouslyBypassPermissions) return 'bypassPermissions';
  return 'default';
}

/**
 * Normalize tool result content (arrays of text blocks, etc.) into a plain string.
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (typeof block === 'string') return block;
        if (block?.type === 'text') return block.text ?? '';
        return JSON.stringify(block);
      })
      .join('\n');
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content);
  }
  return String(content ?? '');
}

interface PendingPermission {
  resolve: (result: { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }) => void;
  reject: (reason?: unknown) => void;
  toolName: string;
}

/**
 * Spawn a Claude agent using the `@anthropic-ai/claude-agent-sdk` package
 * instead of a CLI subprocess.  Implements the same AgentHandle interface
 * so callers (ipc-handlers, stall-monitor) don't need changes.
 */
export function spawnClaudeSdk(options: SpawnOptions): AgentHandle {
  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'claude-code';

  const abortController = new AbortController();
  const pendingPermissions = new Map<string, PendingPermission>();
  let finished = false;
  let queryInstance: Query | null = null;

  // Build the prompt — include context block (repo map) if available
  let effectivePrompt = options.prompt;
  if (options.contextBlock) {
    effectivePrompt = `${options.contextBlock}\n\n${effectivePrompt}`;
  }

  // Build SDK options
  const sdkOptions: Parameters<typeof query>[0]['options'] = {
    cwd: options.cwd,
    model: options.model,
    permissionMode: mapPermissionMode(options),
    abortController,
    allowDangerouslySkipPermissions: options.dangerouslyBypassPermissions ?? false,
    includePartialMessages: true,
    effort: mapEffort(options.thinking),
    thinking: { type: 'adaptive' as const },
    settingSources: ['project' as const],

    // Session resume
    ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),

    // Permission callback — the core of the SDK integration
    canUseTool: async (toolName: string, input: Record<string, unknown>, callOptions: { signal: AbortSignal; toolUseID: string }) => {
      const baseName = extractMcpToolBaseName(toolName);

      // AskUserQuestion: emit question_request, wait for answer
      if (baseName === 'AskUserQuestion' || baseName === 'request_user_input') {
        const questions = normalizeClaudeQuestions(input as Record<string, any>);
        const firstQuestion = questions[0];
        const content = questions.length === 1
          ? (firstQuestion?.question ?? 'Question')
          : `${firstQuestion?.question ?? 'Question'}\n\n${questions.length - 1} more question${questions.length > 2 ? 's' : ''} pending`;

        const requestId = callOptions.toolUseID;
        emitMessage({
          type: 'question_request',
          role: 'assistant',
          content,
          timestamp: Date.now(),
          requestId,
          questions,
          options: firstQuestion?.options,
          allowFreeform: questions.some((q) => q.allowFreeform),
          placeholder: firstQuestion?.placeholder,
        });

        return new Promise((resolve, reject) => {
          callOptions.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
          pendingPermissions.set(requestId, { resolve, reject, toolName });
        });
      }

      // Bypass mode: auto-approve everything
      if (options.dangerouslyBypassPermissions) {
        return { behavior: 'allow' as const };
      }

      // Interactive tools (ExitPlanMode, EnterPlanMode, DiffComment): auto-approve
      if (isInteractiveToolName(baseName)) {
        return { behavior: 'allow' as const };
      }

      // Normal permission request: emit to renderer, wait for user
      const requestId = callOptions.toolUseID;
      emitMessage({
        type: 'permission_request',
        role: 'system',
        content: `Permission requested: ${toolName}`,
        timestamp: Date.now(),
        requestId,
        toolName,
        action: toolName,
      });

      return new Promise((resolve, reject) => {
        callOptions.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        pendingPermissions.set(requestId, { resolve, reject, toolName });
      });
    },
  };

  // Wire up AgentHandle methods

  emitter.stop = async () => {
    finished = true;
    abortController.abort();
    queryInstance?.close();
    // Reject any pending permissions
    for (const [, pending] of pendingPermissions) {
      pending.reject(new Error('Stopped'));
    }
    pendingPermissions.clear();
  };

  emitter.approve = (requestId: string) => {
    const pending = pendingPermissions.get(requestId);
    if (pending) {
      pendingPermissions.delete(requestId);
      pending.resolve({ behavior: 'allow' });
    }
  };

  emitter.deny = (requestId: string) => {
    const pending = pendingPermissions.get(requestId);
    if (pending) {
      pendingPermissions.delete(requestId);
      pending.resolve({ behavior: 'deny', message: 'User denied permission' });
    }
  };

  emitter.answerQuestion = (requestId: string, response: string) => {
    const pending = pendingPermissions.get(requestId);
    if (pending) {
      pendingPermissions.delete(requestId);
      // For AskUserQuestion, pass the answer via updatedInput
      pending.resolve({
        behavior: 'allow',
        updatedInput: { answer: response },
      });
    }
  };

  emitter.steer = (prompt: string, images?: string[]) => {
    if (!queryInstance || finished) return;
    // Use streamInput to send a follow-up user message
    const userMessage = {
      type: 'user' as const,
      session_id: '',
      message: {
        role: 'user' as const,
        content: images?.length
          ? [
              { type: 'text' as const, text: prompt },
              ...images.map((data) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: 'image/png' as const, data },
              })),
            ]
          : [{ type: 'text' as const, text: prompt }],
      },
      parent_tool_use_id: null,
    };
    // streamInput expects an async iterable
    const stream = (async function* () {
      yield userMessage;
    })();
    queryInstance.streamInput(stream).catch(() => {});
  };

  emitter.isAlive = () => !finished && !abortController.signal.aborted;

  // Helper to emit an AgentMessage on the handle
  function emitMessage(msg: AgentMessage) {
    emitter.emit('message', msg);
  }

  // Start the SDK query and process messages
  async function run() {
    try {
      const q = query({
        prompt: effectivePrompt,
        options: sdkOptions,
      });
      queryInstance = q;

      for await (const msg of q) {
        if (finished) break;

        const now = Date.now();

        // System init message — capture session ID
        if (msg.type === 'system' && (msg as any).subtype === 'init') {
          const sessionId = (msg as any).session_id;
          if (sessionId) {
            emitter.emit('session-meta', { id: sessionId });
          }
          continue;
        }

        // Assistant message — parse content blocks
        if (msg.type === 'assistant' && (msg as any).message?.content) {
          const blocks: any[] = (msg as any).message.content;
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              emitMessage({
                type: 'text',
                role: 'assistant',
                content: block.text,
                timestamp: now,
              });
            } else if (block.type === 'thinking' && block.thinking) {
              emitMessage({
                type: 'thinking',
                role: 'assistant',
                content: block.thinking,
                timestamp: now,
              });
            } else if (block.type === 'tool_use') {
              emitMessage({
                type: 'tool_call',
                role: 'assistant',
                content: `Using tool: ${block.name}`,
                timestamp: now,
                toolName: block.name,
                toolInput: block.input ?? {},
                toolCallId: block.id,
              });
            }
          }
          continue;
        }

        // Stream events (partial deltas from streaming)
        if (msg.type === 'stream_event') {
          const event = (msg as any).event;
          if (event?.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              emitMessage({ type: 'text', role: 'assistant', content: event.delta.text, timestamp: now });
            } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
              emitMessage({ type: 'thinking', role: 'assistant', content: event.delta.thinking, timestamp: now });
            }
          }
          continue;
        }

        // User message with tool results
        if (msg.type === 'user') {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result') {
                emitMessage({
                  type: 'tool_result',
                  role: 'tool',
                  content: normalizeToolResultContent(block.content),
                  timestamp: now,
                  toolCallId: block.tool_use_id,
                  isError: block.is_error ?? false,
                });
              }
            }
          }
          continue;
        }

        // Result message — task complete
        if (msg.type === 'result') {
          const result = msg as any;
          const sessionId = result.session_id;
          if (sessionId) {
            emitter.emit('session-meta', { id: sessionId });
          }

          emitMessage({
            type: 'result',
            role: 'assistant',
            content: result.result ?? '',
            timestamp: now,
            costUsd: result.total_cost_usd,
            inputTokens: result.total_input_tokens,
            outputTokens: result.total_output_tokens,
            durationMs: result.duration_ms,
          });
          continue;
        }

        // Rate limit event
        if (msg.type === 'rate_limit_event') {
          const info = (msg as any).rate_limit_info ?? msg;
          const utilization = typeof info.utilization === 'number' ? info.utilization : 0;
          emitMessage({
            type: 'rate_limit',
            role: 'system',
            content: `Claude rate limit ${Math.round(utilization * 100)}%`,
            timestamp: now,
            rateLimitInfo: { ...info, utilization },
          });
          continue;
        }

        // Tool progress messages → status
        if (msg.type === 'tool_progress') {
          emitMessage({
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: (msg as any).message ?? (msg as any).content ?? 'Agent working...',
            timestamp: now,
          });
          continue;
        }
      }

      // Query finished normally
      finished = true;
      emitter.emit('done', { error: null });
    } catch (err: any) {
      finished = true;
      if (abortController.signal.aborted) {
        // Stopped intentionally
        emitter.emit('done', { error: null });
      } else {
        const errorMessage = err?.message ?? String(err);
        emitMessage({
          type: 'error',
          role: 'system',
          content: errorMessage,
          timestamp: Date.now(),
        });
        emitter.emit('done', { error: errorMessage });
      }
    }
  }

  // Emit initial startup status
  emitMessage({
    type: 'status',
    role: 'system',
    statusKind: 'spawn',
    content: 'Starting Claude (SDK)...',
    timestamp: Date.now(),
  });

  // Start the async loop (unhandled promise rejections are caught inside run())
  run();

  return emitter;
}
