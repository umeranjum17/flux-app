import { AgentHandle, AgentMessage, SpawnOptions } from './types';
import { createCliAgentHandle } from './cli-agent';

export const COPILOT_STARTUP_TIMEOUT_MS = 30_000;
const COPILOT_DELTA_FLUSH_MS = 32;

function classifyCopilotExit(code: number | null, stderr: string): string {
  const normalized = stderr.toLowerCase();
  if (normalized.includes('not authenticated') || normalized.includes('login') || normalized.includes('copilot requests')) {
    return 'GitHub Copilot authentication failed. Run "copilot login" or provide a supported GitHub token.';
  }
  if (normalized.includes('rate limit') || normalized.includes('quota') || normalized.includes('premium request')) {
    return 'GitHub Copilot is rate limited or out of premium requests.';
  }
  if (normalized.includes('trusted directories') || normalized.includes('trust')) {
    return 'GitHub Copilot blocked access because the working directory is not trusted.';
  }
  if (normalized.includes('command not found') || normalized.includes('not recognized')) {
    return 'GitHub Copilot CLI not found. Install it and ensure "copilot" is on PATH.';
  }
  if (code === 137 || code === 9) {
    return 'GitHub Copilot CLI was killed before it completed.';
  }
  if (code === 143 || code === 15) {
    return 'GitHub Copilot CLI was terminated.';
  }
  const hint = stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : '';
  return `GitHub Copilot exited with code ${code}${hint}`;
}

function isCopilotFileEditTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.includes('edit') || name.includes('write') || name.includes('patch');
}

function extractCopilotFilePath(args: Record<string, any>): string | undefined {
  return (args.file_path ?? args.path ?? args.filePath ?? args.fileName) as string | undefined;
}

export function spawnCopilot(options: SpawnOptions): AgentHandle {
  // Streaming state: coalesce rapid token deltas before emitting them to the
  // renderer. Copilot often alternates tiny reasoning/text deltas; buffering
  // keeps the stream stable and suppresses the redundant full-content events
  // that usually follow.
  let hasReceivedTextDelta = false;
  let hasReceivedReasoningDelta = false;
  let textDeltaBuffer = '';
  let reasoningDeltaBuffer = '';
  let flushTimer: NodeJS.Timeout | null = null;

  // Track file-edit tool call IDs so we can suppress their progress events
  // (progress events break the tool_call → tool_result merge in the renderer).
  const fileEditToolCallIds = new Set<string>();

  const clearFlushTimer = () => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const flushDeltas = (emitMessage: (message: AgentMessage) => void) => {
    clearFlushTimer();
    if (!reasoningDeltaBuffer && !textDeltaBuffer) return;

    const timestamp = Date.now();

    if (reasoningDeltaBuffer) {
      emitMessage({
        type: 'thinking',
        role: 'assistant',
        content: reasoningDeltaBuffer,
        timestamp,
      });
      reasoningDeltaBuffer = '';
    }

    if (textDeltaBuffer) {
      emitMessage({
        type: 'text',
        role: 'assistant',
        content: textDeltaBuffer,
        timestamp: Date.now(),
      });
      textDeltaBuffer = '';
    }
  };

  const scheduleFlush = (emitMessage: (message: AgentMessage) => void) => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushDeltas(emitMessage);
    }, COPILOT_DELTA_FLUSH_MS);
  };

  return createCliAgentHandle(options, {
    agentId: 'copilot',
    label: 'GitHub Copilot',
    defaultCommand: 'copilot',
    startupTimeoutMs: COPILOT_STARTUP_TIMEOUT_MS,

    buildArgs(opts) {
      const args: string[] = [
        '--output-format', 'json',
        '--stream', 'on',
        '--no-color',
      ];

      if (opts.model && opts.model !== 'auto') {
        args.push('--model', opts.model);
      }

      if (opts.thinking && opts.thinking !== 'disabled') {
        args.push('--reasoning-effort', opts.thinking);
      }

      // Non-interactive JSONL mode requires automatic tool approval.
      args.push('--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--no-ask-user');

      if (opts.mode === 'act') {
        args.push('--autopilot');
      }

      if (opts.resumeSessionId) {
        args.push(`--resume=${opts.resumeSessionId}`);
      }

      args.push('--prompt', opts.prompt);
      return args;
    },

    mapEvent: mapCopilotEvent,
    classifyExit: classifyCopilotExit,

    hooks: {
      onEvent(event, ctx) {
        // Track delta streaming to prevent content doubling and to reduce
        // churn from token-level updates.
        if (event.type === 'assistant.message_delta') {
          textDeltaBuffer += (event.data?.deltaContent ?? '') as string;
          hasReceivedTextDelta = true;
          scheduleFlush(ctx.emitMessage);
          return true;
        }
        if (event.type === 'assistant.reasoning_delta') {
          reasoningDeltaBuffer += (event.data?.deltaContent ?? '') as string;
          hasReceivedReasoningDelta = true;
          scheduleFlush(ctx.emitMessage);
          return true;
        }

        flushDeltas(ctx.emitMessage);

        // Suppress full assistant.message when deltas already delivered the content
        if (event.type === 'assistant.message' && hasReceivedTextDelta) {
          hasReceivedTextDelta = false;
          return true;
        }
        // Suppress full assistant.reasoning when deltas already delivered the content
        if (event.type === 'assistant.reasoning' && hasReceivedReasoningDelta) {
          hasReceivedReasoningDelta = false;
          return true;
        }

        if (event.type === 'result' || event.type === 'abort') {
          hasReceivedTextDelta = false;
          hasReceivedReasoningDelta = false;
        }

        // Suppress partial tool results — the final tool.execution_complete
        // carries the authoritative output. Partial results only add clutter
        // and cause duplicate tool_result entries in the message list.
        if (event.type === 'tool.execution_partial_result') {
          return true;
        }

        // Track file-edit tool calls so we can suppress their progress events.
        // Progress events between tool_call and tool_result break the inline
        // merge in the renderer (Codex doesn't emit these for file edits).
        if (event.type === 'tool.execution_start') {
          const toolName = (event.data?.toolName ?? '') as string;
          const toolCallId = event.data?.toolCallId as string | undefined;
          if (toolCallId && isCopilotFileEditTool(toolName)) {
            fileEditToolCallIds.add(toolCallId);
          }
        }
        if (event.type === 'tool.execution_progress') {
          const toolCallId = event.data?.toolCallId as string | undefined;
          if (toolCallId && fileEditToolCallIds.has(toolCallId)) {
            return true; // suppress progress for file edits
          }
        }
        if (event.type === 'tool.execution_complete') {
          const toolCallId = event.data?.toolCallId as string | undefined;
          if (toolCallId) fileEditToolCallIds.delete(toolCallId);
        }

        return false;
      },

      extractSessionMeta(event) {
        if (event.type === 'session.start' && typeof event.data?.sessionId === 'string') {
          return { id: event.data.sessionId };
        }
        if (event.type === 'result' && typeof event.sessionId === 'string') {
          return { id: event.sessionId };
        }
        return null;
      },

      onBeforeFinish(_code, ctx) {
        flushDeltas(ctx.emitMessage);
        return false;
      },

      onStop() {
        clearFlushTimer();
      },

      onCleanup() {
        clearFlushTimer();
      },
    },
  });
}

function mapCopilotEvent(event: Record<string, any>): AgentMessage | null {
  const now = Date.now();

  if (event.type === 'assistant.message_delta') {
    return {
      type: 'text',
      role: 'assistant',
      content: event.data?.deltaContent ?? '',
      timestamp: now,
    };
  }

  if (event.type === 'assistant.reasoning_delta') {
    return {
      type: 'thinking',
      role: 'assistant',
      content: event.data?.deltaContent ?? '',
      timestamp: now,
    };
  }

  if (event.type === 'assistant.message') {
    return {
      type: 'text',
      role: 'assistant',
      content: event.data?.content ?? '',
      timestamp: now,
      outputTokens: event.data?.outputTokens,
    };
  }

  if (event.type === 'assistant.reasoning') {
    return {
      type: 'thinking',
      role: 'assistant',
      content: event.data?.content ?? '',
      timestamp: now,
    };
  }

  if (event.type === 'tool.execution_start') {
    const toolName = (event.data?.toolName ?? 'unknown') as string;
    const args = (event.data?.arguments ?? {}) as Record<string, any>;

    // Normalize file-edit tools to match the Codex pattern: only pass the
    // file path in toolInput and set filePath explicitly.  The actual diff
    // data arrives later via the agent:diff IPC event (git diff).
    if (isCopilotFileEditTool(toolName)) {
      const filePath = extractCopilotFilePath(args);
      return {
        type: 'tool_call',
        role: 'assistant',
        content: `Calling: ${toolName}`,
        timestamp: now,
        toolName,
        toolInput: { path: filePath ?? '' },
        toolCallId: event.data?.toolCallId,
        ...(filePath ? { filePath } : {}),
      };
    }

    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Using tool: ${toolName}`,
      timestamp: now,
      toolName,
      toolInput: args,
      toolCallId: event.data?.toolCallId,
    };
  }

  if (event.type === 'tool.execution_progress') {
    return {
      type: 'status',
      role: 'system',
      statusKind: 'progress',
      content: event.data?.progressMessage ?? 'Tool running...',
      timestamp: now,
      toolCallId: event.data?.toolCallId,
    };
  }

  if (event.type === 'tool.execution_partial_result') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: event.data?.partialOutput ?? '',
      timestamp: now,
      toolCallId: event.data?.toolCallId,
    };
  }

  if (event.type === 'tool.execution_complete') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: readCopilotToolResult(event.data?.result),
      timestamp: now,
      toolCallId: event.data?.toolCallId,
      isError: event.data?.success === false,
    };
  }

  if (event.type === 'permission.requested') {
    const permission = event.data?.permissionRequest;
    return {
      type: 'permission_request',
      role: 'system',
      content: permission?.intention ?? permission?.toolDescription ?? 'Permission requested',
      timestamp: now,
      requestId: event.data?.requestId,
      action: permission?.kind,
      toolName: permission?.toolName,
      filePath: permission?.fileName ?? permission?.path,
    };
  }

  if (event.type === 'user_input.requested') {
    return {
      type: 'question_request',
      role: 'assistant',
      content: event.data?.question ?? 'GitHub Copilot needs input',
      timestamp: now,
      requestId: event.data?.requestId,
      questions: [{ question: event.data?.question ?? 'GitHub Copilot needs input', options: (event.data?.choices ?? []).map((choice: string) => ({ label: choice })), allowFreeform: event.data?.allowFreeform !== false }],
      options: (event.data?.choices ?? []).map((choice: string) => ({ label: choice })),
      allowFreeform: event.data?.allowFreeform !== false,
    };
  }

  if (event.type === 'session.info' || event.type === 'session.warning') {
    return {
      type: 'status',
      role: 'system',
      statusKind: 'diagnostic',
      content: event.data?.message ?? '',
      timestamp: now,
    };
  }

  if (event.type === 'session.error') {
    return {
      type: 'error',
      role: 'system',
      content: event.data?.message ?? 'GitHub Copilot reported an error',
      timestamp: now,
    };
  }

  if (event.type === 'result') {
    return {
      type: 'result',
      role: 'assistant',
      content: '',
      timestamp: now,
      inputTokens: event.usage?.inputTokens,
      outputTokens: event.usage?.outputTokens,
      durationMs: event.usage?.totalApiDurationMs ?? event.usage?.sessionDurationMs,
    };
  }

  if (event.type === 'assistant.usage') {
    const totalNanoAiu = event.data?.copilotUsage?.totalNanoAiu;
    return {
      type: 'result',
      role: 'assistant',
      content: '',
      timestamp: now,
      inputTokens: event.data?.inputTokens,
      outputTokens: event.data?.outputTokens,
      durationMs: event.data?.duration,
      ...(typeof totalNanoAiu === 'number' ? { costUsd: totalNanoAiu / 1_000_000_000 } : {}),
    };
  }

  if (event.type === 'abort') {
    return {
      type: 'status',
      role: 'system',
      statusKind: 'progress',
      content: event.data?.reason ?? 'GitHub Copilot aborted the current turn',
      timestamp: now,
    };
  }

  return null;
}

function readCopilotToolResult(result: Record<string, any> | undefined): string {
  if (!result) return '';
  if (typeof result.detailedContent === 'string' && result.detailedContent.trim()) {
    return result.detailedContent;
  }
  if (typeof result.content === 'string' && result.content.trim()) {
    return result.content;
  }
  if (Array.isArray(result.contents)) {
    const content = result.contents
      .map((entry) => {
        if (entry?.type === 'text' || entry?.type === 'terminal') {
          return typeof entry.text === 'string' ? entry.text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (content) return content;
  }
  return JSON.stringify(result);
}
