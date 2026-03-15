import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentHandle, SpawnOptions, AgentMessage, QuestionField, PLAN_FORMAT_PREAMBLE } from './types';
import { createCliAgentHandle } from './cli-agent';
import { safeWriteToChildStdin } from '../process-utils';
import {
  extractCodexSessionMeta,
  hasCodexProfile,
  inferCodexProfile,
  mapCodexReasoningEffort,
} from './codex-utils';
import type { McpServerConfig } from './mcp-config';

export const CODEX_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Map a Codex CLI exit code + stderr into a user-friendly error message.
 */
function classifyCodexExit(code: number | null, stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('rate limit') || s.includes('rate_limit') || s.includes('429')) {
    return 'Rate limited by OpenAI API. Wait a few minutes or switch to a different model.';
  }
  if (s.includes('authentication') || s.includes('unauthorized') || s.includes('api key') || s.includes('invalid_api_key')) {
    return 'Authentication failed. Check your OpenAI API key or run "codex auth" in your terminal.';
  }
  if (s.includes('context') && (s.includes('length') || s.includes('window') || s.includes('tokens'))) {
    return 'Context window exceeded. Start a new session or use a model with larger context.';
  }
  if (s.includes('econnrefused') || s.includes('enotfound') || s.includes('network') || s.includes('fetch failed')) {
    return 'Network connectivity issue. Check your internet connection.';
  }
  if (s.includes('command not found') || s.includes('not recognized')) {
    return 'Codex CLI not found. Install it with "npm install -g @openai/codex".';
  }
  if (code === 137 || code === 9) {
    return 'Process was killed (likely out of memory). Try reducing the scope of your request.';
  }
  if (code === 143 || code === 15) {
    return 'Process was terminated.';
  }
  const lines = stderr.split('\n').filter(l => l.trim()).slice(-3);
  const hint = lines.length > 0 ? `: ${lines.join(' | ')}` : '';
  return `Codex exited with code ${code}${hint}`;
}

/**
 * Spawn a Codex CLI subprocess and parse its JSONL output.
 */
export function spawnCodex(
  options: SpawnOptions,
  mcpServers?: Record<string, McpServerConfig>,
): AgentHandle {
  let imageDir: string | null = null;
  let imageWarning: string | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  // Capture first 2KB of raw stderr for diagnostics on timeout
  let stderrCapture = '';
  const STDERR_CAPTURE_LIMIT = 2048;

  // Prepare images
  if (options.images?.length) {
    if (options.sshHost) {
      imageWarning = 'Codex image attachments are not supported over SSH yet. They were skipped.';
    } else {
      try {
        const persisted = persistImages(options.images);
        imageDir = persisted.directory;
        // Store paths for use in buildArgs — we attach them via closure
        (options as any)._codexImagePaths = persisted.paths;
      } catch (err: any) {
        imageWarning = `Codex image attachments could not be prepared: ${err.message ?? String(err)}`;
      }
    }
  }

  const cleanupPersistedImages = (() => {
    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      cleanupTempDir(imageDir);
    };
  })();

  const isResume = !!options.resumeSessionId;
  const inferredProfile = inferCodexProfile(options);
  const reasoningEffort = mapCodexReasoningEffort(options.thinking);

  return createCliAgentHandle(options, {
    agentId: 'codex',
    label: 'Codex',
    defaultCommand: 'codex',
    startupTimeoutMs: CODEX_STARTUP_TIMEOUT_MS,

    buildArgs(opts) {
      const args: string[] = isResume ? ['exec', 'resume'] : ['exec'];

      if (opts.mode === 'act') {
        if (opts.dangerouslyBypassPermissions) {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        } else {
          args.push('--full-auto');
        }
      } else if (opts.mode === 'plan' && !isResume) {
        args.push('--sandbox', 'read-only');
      }

      args.push('--skip-git-repo-check');

      if (!isResume && !opts.sshHost && hasCodexProfile(inferredProfile)) {
        args.push('--profile', inferredProfile);
      }

      if (opts.model) {
        args.push('--model', opts.model);
      }

      if (reasoningEffort) {
        args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
      }

      addCodexMcpConfigArgs(args, mcpServers);

      const imagePaths = (opts as any)._codexImagePaths as string[] | undefined;
      if (imagePaths) {
        for (const imagePath of imagePaths) {
          args.push('--image', imagePath);
        }
      }

      args.push('--json');
      if (isResume) {
        args.push(opts.resumeSessionId!);
      }

      const prompt = opts.mode === 'plan'
        ? `${PLAN_FORMAT_PREAMBLE}\n\n${opts.prompt}`
        : opts.prompt;
      args.push('--', prompt);

      return args;
    },

    mapEvent: mapCodexEvent,
    classifyExit: classifyCodexExit,

    controls: {
      // Codex in --full-auto mode handles permissions automatically
      steer(proc, prompt) {
        safeWriteToChildStdin(proc, prompt + '\n', 'codex');
      },
      answerQuestion(proc, _requestId, response) {
        safeWriteToChildStdin(proc, response + '\n', 'codex');
      },
    },

    hooks: {
      extractSessionMeta(event) {
        const sessionMeta = extractCodexSessionMeta(event);
        if (sessionMeta) return sessionMeta;
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          return {
            id: event.thread_id,
            cwd: options.cwd,
            createdAt: Date.now(),
          };
        }
        return null;
      },

      onAfterSpawn(proc, ctx) {
        // Capture early stderr for timeout diagnostics
        proc.stderr?.on('data', (chunk: Buffer) => {
          if (stderrCapture.length < STDERR_CAPTURE_LIMIT) {
            stderrCapture += chunk.toString('utf-8').slice(0, STDERR_CAPTURE_LIMIT - stderrCapture.length);
          }
        });

        // Emit image warning
        if (imageWarning) {
          setTimeout(() => {
            ctx.emitMessage({
              type: 'text',
              role: 'system',
              content: imageWarning!,
              timestamp: Date.now(),
            } satisfies AgentMessage);
          }, 0);
        }

        // Startup heartbeats every 10s to prevent UI showing "Stalled"
        heartbeatInterval = setInterval(() => {
          if (ctx.isFinished() || ctx.isStopped()) {
            clearInterval(heartbeatInterval);
            return;
          }
          ctx.emitter.emit('message', {
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: 'Starting Codex…',
            timestamp: Date.now(),
          } satisfies AgentMessage);
        }, 10_000);
      },

      onTimeout(error, ctx) {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        const detail = stderrCapture.trim()
          ? `${error}\n\nStderr output:\n${stderrCapture.trim()}`
          : error;
        ctx.emitMessage({
          type: 'error',
          role: 'system',
          content: detail,
          timestamp: Date.now(),
        });
        void ctx.requestShutdown().finally(() => ctx.finish({ code: 1, error: detail }));
        return true; // suppress default timeout handling
      },

      onBeforeFinish(_code, _ctx) {
        cleanupPersistedImages();
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        return false; // proceed with default finish
      },

      onCleanup() {
        cleanupPersistedImages();
      },

      onStop() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      },
    },
  });
}

function persistImages(images: string[]): { directory: string; paths: string[] } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-codex-'));
  const paths = images.map((image, index) => {
    const match = image.match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
      throw new Error('unsupported image payload');
    }

    const [, mimeType, base64] = match;
    const extension = mimeToExtension(mimeType);
    const filePath = path.join(directory, `image-${index + 1}.${extension}`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  });

  return { directory, paths };
}

function mimeToExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}

function cleanupTempDir(directory: string | null): void {
  if (!directory) return;
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

/**
 * Map a Codex JSON event to our unified AgentMessage format.
 */
function mapCodexEvent(event: any): AgentMessage | null {
  const now = Date.now();
  if (!event || typeof event !== 'object') {
    return null;
  }

  // Codex CLI JSONL format: item.completed, item.started, turn.completed
  if (event.type === 'item.completed' && event.item) {
    return mapCodexItemCompleted(event.item, now);
  }

  if (event.type === 'item.started' && event.item) {
    return mapCodexItemStarted(event.item, now);
  }

  if (event.type === 'turn.completed') {
    const usage = event.usage;
    return {
      type: 'result',
      role: 'assistant',
      content: '',
      timestamp: now,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
    };
  }

  if (event.type === 'thread.started' || event.type === 'turn.started') {
    return null;
  }

  if (event.type === 'event_msg') {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (payload.type === 'agent_message') {
      const content = readCodexString(payload.message, payload.content, payload.text);
      if (!content) return null;
      return {
        type: 'status',
        role: 'system',
        content,
        timestamp: now,
        statusKind: 'progress',
      };
    }

    if (payload.type === 'agent_reasoning') {
      const content = readCodexString(payload.text, payload.message, payload.content);
      if (!content) return null;
      return {
        type: 'thinking',
        role: 'assistant',
        content,
        timestamp: now,
      };
    }

    if (payload.type === 'token_count') {
      return mapCodexRateLimit(payload, now);
    }
  }

  const normalized = unwrapCodexEvent(event);
  if (!normalized) {
    return null;
  }

  if (normalized.type === 'token_count') {
    return mapCodexRateLimit(normalized, now);
  }

  if (normalized.type === 'reasoning') {
    const content = extractCodexReasoningSummary(normalized);
    if (content) {
      return {
        type: 'thinking',
        role: 'assistant',
        content,
        timestamp: now,
      };
    }

    return {
      type: 'status',
      role: 'system',
      content: 'Thinking',
      timestamp: now,
      statusKind: 'progress',
    };
  }

  if (normalized.type === 'message' || normalized.role) {
    const role = normalized.role ?? 'assistant';
    if (role === 'developer' || role === 'user') {
      return null;
    }

    const content = extractCodexMessageText(normalized.content);
    if (content) {
      return {
        type: 'text',
        role,
        content,
        timestamp: now,
      };
    }
  }

  if (
    normalized.type === 'function_call' ||
    normalized.type === 'tool_call' ||
    normalized.type === 'custom_tool_call'
  ) {
    return mapCodexToolCall(normalized, now);
  }

  if (
    normalized.type === 'function_call_output' ||
    normalized.type === 'tool_result' ||
    normalized.type === 'custom_tool_call_output'
  ) {
    return {
      type: 'tool_result',
      role: 'tool',
      content: stringifyCodexOutput(normalized.output ?? normalized.content ?? normalized.result ?? ''),
      timestamp: now,
      toolCallId: normalized.call_id ?? normalized.tool_use_id ?? normalized.id,
      isError: normalized.is_error ?? false,
    };
  }

  if (normalized.type === 'result' || normalized.type === 'completion') {
    const usage = normalized.usage ?? normalized.result?.usage ?? normalized.completion?.usage;
    return {
      type: 'result',
      role: 'assistant',
      content: normalized.result ?? normalized.text ?? '',
      timestamp: now,
      costUsd: normalized.cost_usd ?? normalized.total_cost_usd ?? normalized.total_cost ?? usage?.cost_usd,
      inputTokens: usage?.input_tokens ?? normalized.input_tokens,
      outputTokens: usage?.output_tokens ?? normalized.output_tokens,
      durationMs: normalized.duration_ms ?? normalized.duration_api_ms,
    };
  }

  if (normalized.type === 'error') {
    return {
      type: 'error',
      role: 'system',
      content: normalized.message ?? normalized.error ?? JSON.stringify(normalized),
      timestamp: now,
    };
  }

  return null;
}

function tryParseJson(str: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through
  }

  return { raw: str };
}

function unwrapCodexEvent(event: any): any {
  if (!event || typeof event !== 'object') {
    return null;
  }

  if ((event.type === 'response_item' || event.type === 'event_msg') && event.payload) {
    return event.payload;
  }

  return event;
}

function mapCodexRateLimitStatus(utilization: number): 'allowed' | 'allowed_warning' | 'rejected' {
  if (utilization >= 1) return 'rejected';
  if (utilization >= 0.8) return 'allowed_warning';
  return 'allowed';
}

function mapCodexRateLimit(normalized: any, timestamp: number): AgentMessage | null {
  if (!normalized?.rate_limits?.primary) {
    return null;
  }

  const primary = normalized.rate_limits.primary;
  const secondary = normalized.rate_limits.secondary;
  const primaryUtilization = normalizeCodexUtilization(primary.used_percent);
  const secondaryUtilization = normalizeCodexUtilization(secondary?.used_percent);
  const utilization = Math.max(primaryUtilization ?? 0, secondaryUtilization ?? 0);

  return {
    type: 'rate_limit',
    role: 'system',
    content: `Codex rate limit ${Math.round(utilization * 100)}%`,
    timestamp,
    rateLimitInfo: {
      status: mapCodexRateLimitStatus(utilization),
      resetsAt: typeof primary.resets_at === 'number' ? primary.resets_at * 1000 : timestamp,
      rateLimitType: normalized.rate_limits.limit_name ?? normalized.rate_limits.limit_id ?? 'codex',
      utilization,
      overageStatus: secondaryUtilization !== undefined
        ? mapCodexRateLimitStatus(secondaryUtilization)
        : undefined,
      overageResetsAt: typeof secondary?.resets_at === 'number'
        ? secondary.resets_at * 1000
        : undefined,
    },
  };
}

function normalizeCodexUtilization(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  if (value > 1) {
    return Math.max(0, Math.min(1, value / 100));
  }

  return Math.max(0, Math.min(1, value));
}

function extractCodexMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block: any) => ['text', 'output_text', 'input_text'].includes(block?.type))
    .map((block: any) => block.text ?? block.output_text ?? block.input_text ?? '')
    .join('')
    .trim();
}

function extractCodexReasoningSummary(reasoning: any): string {
  if (!Array.isArray(reasoning?.summary)) {
    return '';
  }

  return reasoning.summary
    .map((item: any) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function mapCodexItemCompleted(item: any, timestamp: number): AgentMessage | null {
  if (item.type === 'agent_message') {
    const content = item.text ?? item.message ?? '';
    if (!content) return null;
    return {
      type: 'text',
      role: 'assistant',
      content,
      timestamp,
    };
  }

  if (item.type === 'agent_reasoning') {
    const content = item.text ?? '';
    if (!content) return null;
    return {
      type: 'thinking',
      role: 'assistant',
      content,
      timestamp,
    };
  }

  if (item.type === 'command_execution') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: item.aggregated_output ?? '',
      timestamp,
      toolCallId: item.id,
      isError: item.exit_code !== 0 && item.exit_code !== null,
    };
  }

  return null;
}

function mapCodexItemStarted(item: any, timestamp: number): AgentMessage | null {
  if (item.type === 'command_execution') {
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Calling: shell`,
      timestamp,
      toolName: 'shell',
      toolInput: { command: item.command ?? '' },
      toolCallId: item.id,
    };
  }

  if (item.type === 'file_read') {
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Calling: read_file`,
      timestamp,
      toolName: 'read_file',
      toolInput: { path: item.path ?? item.file ?? '' },
      toolCallId: item.id,
    };
  }

  if (item.type === 'file_write' || item.type === 'file_patch') {
    const toolName = item.type === 'file_write' ? 'write_file' : 'patch_file';
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Calling: ${toolName}`,
      timestamp,
      toolName,
      toolInput: { path: item.path ?? item.file ?? '' },
      toolCallId: item.id,
    };
  }

  return null;
}

function mapCodexToolCall(normalized: any, timestamp: number): AgentMessage {
  const toolName = normalized.name ?? normalized.function?.name ?? 'unknown';
  const toolInput = getCodexToolInput(normalized);
  const requestId = normalized.call_id ?? normalized.id ?? `question-${timestamp}`;

  if (toolName === 'request_user_input') {
    const question = parseStructuredQuestionRequest(toolInput, requestId, timestamp);
    if (question) {
      return question;
    }
  }

  return {
    type: 'tool_call',
    role: 'assistant',
    content: `Calling: ${toolName}`,
    timestamp,
    toolName,
    toolInput,
    toolCallId: normalized.call_id ?? normalized.id,
  };
}

function getCodexToolInput(normalized: any): Record<string, unknown> {
  if (typeof normalized.arguments === 'string') {
    return tryParseJson(normalized.arguments);
  }

  if (normalized.input && typeof normalized.input === 'object' && !Array.isArray(normalized.input)) {
    return normalized.input as Record<string, unknown>;
  }

  if (typeof normalized.input === 'string') {
    return { raw: normalized.input };
  }

  return {};
}

function parseStructuredQuestionRequest(
  toolInput: Record<string, unknown>,
  requestId: string,
  timestamp: number,
): AgentMessage | null {
  const questions = normalizeQuestionFields(toolInput);
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
    requestId,
    questions,
    options: firstQuestion.options,
    allowFreeform: questions.some((question) => question.allowFreeform),
    placeholder: firstQuestion.placeholder,
  };
}

function normalizeQuestionFields(toolInput: Record<string, unknown>): QuestionField[] {
  const rawQuestions = Array.isArray(toolInput.questions)
    ? toolInput.questions
    : typeof toolInput.question === 'string'
      ? [{ question: toolInput.question, header: toolInput.header, options: toolInput.options, placeholder: toolInput.placeholder }]
      : [];

  return rawQuestions
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const options = Array.isArray(item.options)
        ? item.options
          .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object' && !Array.isArray(option))
          .map((option) => ({
            label: typeof option.label === 'string' ? option.label : String(option.value ?? ''),
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
            ...(typeof option.value === 'string' ? { value: option.value } : {}),
          }))
          .filter((option) => option.label.trim().length > 0)
        : undefined;
      const allowFreeform = typeof item.allowFreeform === 'boolean'
        ? item.allowFreeform
        : typeof item.allow_freeform === 'boolean'
          ? item.allow_freeform
          : !options || options.length === 0;

      return {
        ...(typeof item.header === 'string' ? { header: item.header } : {}),
        question: typeof item.question === 'string' ? item.question : String(item.prompt ?? ''),
        ...(options?.length ? { options } : {}),
        allowFreeform,
        ...(typeof item.placeholder === 'string' ? { placeholder: item.placeholder } : {}),
        ...(typeof item.multiSelect === 'boolean' ? { multiSelect: item.multiSelect } : {}),
      };
    })
    .filter((question) => question.question.trim().length > 0);
}

function stringifyCodexOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

function readCodexString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function addCodexMcpConfigArgs(
  args: string[],
  mcpServers?: Record<string, McpServerConfig>,
): void {
  if (!mcpServers) return;

  for (const server of Object.values(mcpServers)) {
    if (!server || typeof server.command !== 'string' || !server.command.trim()) {
      continue;
    }

    const keyPath = `mcp_servers.${formatTomlKeyPathSegment(server.name)}`;
    args.push('-c', `${keyPath}.command=${formatTomlString(server.command)}`);

    if (Array.isArray(server.args) && server.args.length > 0) {
      args.push('-c', `${keyPath}.args=${formatTomlStringArray(server.args)}`);
    }

    if (server.env && typeof server.env === 'object') {
      const envEntries = Object.entries(server.env)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
      if (envEntries.length > 0) {
        args.push('-c', `${keyPath}.env=${formatTomlInlineStringTable(envEntries)}`);
      }
    }

    if (typeof server.cwd === 'string' && server.cwd.trim().length > 0) {
      args.push('-c', `${keyPath}.cwd=${formatTomlString(server.cwd)}`);
    }
  }
}

function formatTomlKeyPathSegment(segment: string): string {
  return /^[A-Za-z0-9_-]+$/.test(segment)
    ? segment
    : formatTomlString(segment);
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map(formatTomlString).join(', ')}]`;
}

function formatTomlInlineStringTable(entries: Array<[string, string]>): string {
  return `{${entries.map(([key, value]) => `${formatTomlKeyPathSegment(key)}=${formatTomlString(value)}`).join(', ')}}`;
}
