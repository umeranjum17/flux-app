import { AgentHandle, AgentMessage, SpawnOptions } from './types';
import { createCliAgentHandle, CliAgentContext } from './cli-agent';

export const COPILOT_STARTUP_TIMEOUT_MS = 30_000;

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

// Interval (ms) for coalescing token-level deltas into fewer IPC messages.
// Copilot's --stream sends one event per token; without buffering, each tiny
// delta triggers a SQLite write + IPC send + Zustand update, causing the UI to
// bounce. 32 ms ≈ 2 animation frames — fast enough to feel live, slow enough
// to batch dozens of tokens into a single message.
const DELTA_FLUSH_INTERVAL_MS = 32;

export function spawnCopilot(options: SpawnOptions): AgentHandle {
  // Streaming state: track whether deltas were received so we can suppress
  // the redundant full-content events that would otherwise double the text.
  let hasReceivedTextDelta = false;
  let hasReceivedReasoningDelta = false;

  // --- Delta buffering ---
  // Accumulate text / thinking deltas and flush them as a single merged
  // AgentMessage on a short timer so the renderer gets fewer, larger updates.
  let textBuffer = '';
  let thinkingBuffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushDeltas(ctx: CliAgentContext) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const now = Date.now();
    // Emit thinking before text — matches the natural LLM order (reasoning
    // precedes response) and avoids unnecessary interleaving in the store.
    if (thinkingBuffer) {
      const chunk = thinkingBuffer;
      thinkingBuffer = '';
      ctx.emitMessage({ type: 'thinking', role: 'assistant', content: chunk, timestamp: now });
    }
    if (textBuffer) {
      const chunk = textBuffer;
      textBuffer = '';
      ctx.emitMessage({ type: 'text', role: 'assistant', content: chunk, timestamp: now });
    }
  }

  function scheduleDeltaFlush(ctx: CliAgentContext) {
    if (flushTimer === null) {
      flushTimer = setTimeout(() => flushDeltas(ctx), DELTA_FLUSH_INTERVAL_MS);
    }
  }


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

      if (opts.thinking) {
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
        // Buffer token-level deltas instead of emitting each one individually.
        // This coalesces many tiny IPC messages into fewer, larger ones,
        // preventing the UI from bouncing on every token.
        if (event.type === 'assistant.message_delta') {
          hasReceivedTextDelta = true;
          textBuffer += event.data?.deltaContent ?? '';
          scheduleDeltaFlush(ctx);
          return true; // suppress default mapEvent — we emit on flush
        }
        if (event.type === 'assistant.reasoning_delta') {
          hasReceivedReasoningDelta = true;
          thinkingBuffer += event.data?.deltaContent ?? '';
          scheduleDeltaFlush(ctx);
          return true;
        }

        // Any non-delta event: flush accumulated deltas first so ordering is
        // preserved (e.g. text always appears before the next tool_call).
        flushDeltas(ctx);


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

        // Suppress partial tool results — the final tool.execution_complete
        // carries the authoritative output. Partial results only add clutter
        // and cause duplicate tool_result entries in the message list.
        if (event.type === 'tool.execution_partial_result') {
          return true;
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
        // Flush any remaining buffered deltas before finish so nothing is lost.
        flushDeltas(ctx);
        return false;
      },

      onStop() {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
      },

      onCleanup() {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
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
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Using tool: ${event.data?.toolName ?? 'unknown'}`,
      timestamp: now,
      toolName: event.data?.toolName,
      toolInput: event.data?.arguments ?? {},
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