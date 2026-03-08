import fs from 'fs';
import os from 'os';
import path from 'path';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { spawnAgentProcess } from './spawn-utils';
import {
  extractCodexSessionMeta,
  hasCodexProfile,
  inferCodexProfile,
  mapCodexReasoningEffort,
} from './codex-utils';

/**
 * Spawn a Codex CLI subprocess and parse its JSONL output.
 */
export function spawnCodex(options: SpawnOptions): AgentHandle {
  const args: string[] = options.resumeSessionId
    ? ['exec', 'resume', options.resumeSessionId, '--json']
    : ['exec', '--json'];
  let imageDir: string | null = null;
  let imageWarning: string | null = null;
  const inferredProfile = inferCodexProfile(options);
  const reasoningEffort = mapCodexReasoningEffort(options.thinking);

  if (options.mode === 'act') {
    args.push('--full-auto');
  } else if (options.mode === 'plan') {
    args.push('--sandbox', 'read-only');
  }

  args.push('--skip-git-repo-check');

  if (hasCodexProfile(inferredProfile)) {
    args.push('--profile', inferredProfile);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }

  if (options.images?.length) {
    try {
      const persisted = persistImages(options.images);
      imageDir = persisted.directory;
      for (const imagePath of persisted.paths) {
        args.push('--image', imagePath);
      }
    } catch (err: any) {
      imageWarning = `Codex image attachments could not be prepared: ${err.message ?? String(err)}`;
    }
  }

  // Prompt as last positional argument
  args.push(options.prompt);

  const proc: ChildProcess = spawnAgentProcess({
    command: options.sshHost ? 'codex' : (options.binaryPath || 'codex'),
    args,
    cwd: options.cwd,
    sshHost: options.sshHost,
    remoteCwd: options.remoteCwd,
  });

  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'codex';
  let stopped = false;

  if (imageWarning) {
    setTimeout(() => {
      emitter.emit('message', {
        type: 'text',
        role: 'system',
        content: imageWarning!,
        timestamp: Date.now(),
      } satisfies AgentMessage);
    }, 0);
  }

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
        // Plain text output — emit as text
        emitter.emit('message', {
          type: 'text',
          role: 'assistant',
          content: trimmed,
          timestamp: Date.now(),
        } satisfies AgentMessage);
        continue;
      }

      const sessionMeta = extractCodexSessionMeta(event);
      if (sessionMeta) {
        emitter.emit('session-meta', sessionMeta);
      }

      const message = mapCodexEvent(event);
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
    cleanupTempDir(imageDir);
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const sessionMeta = extractCodexSessionMeta(event);
        if (sessionMeta) {
          emitter.emit('session-meta', sessionMeta);
        }
        const message = mapCodexEvent(event);
        if (message) {
          emitter.emit('message', message);
        }
      } catch {
        // ignore
      }
    }
    emitter.emit('done', {
      code,
      ...(stopped || code === 0 || code === null ? {} : { error: `Codex exited with code ${code}` }),
    });
  });

  proc.on('error', (err: Error) => {
    cleanupTempDir(imageDir);
    try { proc.kill(); } catch {}
    const msg: AgentMessage = {
      type: 'error',
      role: 'system',
      content: `Failed to spawn codex: ${err.message}`,
      timestamp: Date.now(),
    };
    emitter.emit('message', msg);
    emitter.emit('done', { code: 1, error: err.message });
  });

  emitter.stop = () => {
    stopped = true;
    cleanupTempDir(imageDir);
    proc.kill('SIGTERM');
  };

  emitter.approve = (_requestId: string) => {
    // Codex in --full-auto mode handles permissions automatically.
    // In sandbox mode, no approvals are needed.
  };

  emitter.deny = (_requestId: string) => {
    // Not applicable for Codex in auto/sandbox modes
  };

  emitter.steer = (prompt: string) => {
    if (proc.stdin?.writable) {
      proc.stdin.write(prompt + '\n');
    }
  };

  return emitter;
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
  const normalized = unwrapCodexEvent(event);

  if (!normalized) {
    return null;
  }

  if (normalized.type === 'token_count' && normalized.rate_limits?.primary) {
    const primary = normalized.rate_limits.primary;
    const secondary = normalized.rate_limits.secondary;
    const utilization = Math.max(
      typeof primary.used_percent === 'number' ? primary.used_percent : 0,
      typeof secondary?.used_percent === 'number' ? secondary.used_percent : 0,
    );

    return {
      type: 'rate_limit',
      role: 'system',
      content: `Codex rate limit ${Math.round(utilization)}%`,
      timestamp: now,
      rateLimitInfo: {
        status: mapCodexRateLimitStatus(utilization),
        resetsAt: typeof primary.resets_at === 'number' ? primary.resets_at * 1000 : now,
        rateLimitType: normalized.rate_limits.limit_name ?? normalized.rate_limits.limit_id ?? 'codex',
        utilization,
        overageStatus: typeof secondary?.used_percent === 'number'
          ? mapCodexRateLimitStatus(secondary.used_percent)
          : undefined,
        overageResetsAt: typeof secondary?.resets_at === 'number'
          ? secondary.resets_at * 1000
          : undefined,
      },
    };
  }

  // Message event with role
  if (normalized.type === 'message' || normalized.role) {
    const role = normalized.role ?? 'assistant';

    // Text content
    if (typeof normalized.content === 'string') {
      return {
        type: 'text',
        role,
        content: normalized.content,
        timestamp: now,
      };
    }

    // Structured content blocks
    if (Array.isArray(normalized.content)) {
      const textParts = normalized.content
        .filter((b: any) => b.type === 'text' || b.type === 'output_text')
        .map((b: any) => b.text ?? b.output_text ?? '')
        .join('');

      if (textParts) {
        return {
          type: 'text',
          role,
          content: textParts,
          timestamp: now,
        };
      }
    }
  }

  // Function/tool call
  if (normalized.type === 'function_call' || normalized.type === 'tool_call') {
    return {
      type: 'tool_call',
      role: 'assistant',
      content: `Calling: ${normalized.name ?? normalized.function?.name ?? 'unknown'}`,
      timestamp: now,
      toolName: normalized.name ?? normalized.function?.name,
      toolInput: normalized.arguments ? tryParseJson(normalized.arguments) : (normalized.input ?? {}),
      toolCallId: normalized.call_id ?? normalized.id,
    };
  }

  // Function/tool output
  if (normalized.type === 'function_call_output' || normalized.type === 'tool_result') {
    return {
      type: 'tool_result',
      role: 'tool',
      content: typeof normalized.output === 'string' ? normalized.output : JSON.stringify(normalized.output ?? ''),
      timestamp: now,
      toolCallId: normalized.call_id ?? normalized.tool_use_id,
      isError: normalized.is_error ?? false,
    };
  }

  // Completion / result summary
  if (normalized.type === 'result' || normalized.type === 'completion') {
    return {
      type: 'result',
      role: 'assistant',
      content: normalized.result ?? normalized.text ?? '',
      timestamp: now,
      costUsd: normalized.cost_usd,
      inputTokens: normalized.usage?.input_tokens,
      outputTokens: normalized.usage?.output_tokens,
      durationMs: normalized.duration_ms,
    };
  }

  // Error
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
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
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
  if (utilization >= 100) return 'rejected';
  if (utilization >= 80) return 'allowed_warning';
  return 'allowed';
}
