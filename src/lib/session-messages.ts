import type { SessionMessage } from './ipc-api';
import type { AgentMessage } from './types';

export function restoreSessionMessage(message: SessionMessage): AgentMessage | null {
  const restored = restoreStoredMessage(message);
  return sanitizeRestoredMessage(restored);
}

function restoreStoredMessage(message: SessionMessage): AgentMessage {
  if (message.payloadJson) {
    try {
      const parsed = JSON.parse(message.payloadJson) as AgentMessage;
      return {
        ...parsed,
        type: parsed.type ?? (message.type as AgentMessage['type']),
        role: parsed.role ?? (message.role as AgentMessage['role']),
        content: parsed.content ?? message.content,
        timestamp: message.timestamp,
      };
    } catch {
      // Fall through to the legacy columns below.
    }
  }

  return {
    type: message.type as AgentMessage['type'],
    role: message.role as AgentMessage['role'],
    content: message.content,
    timestamp: message.timestamp,
    toolName: message.toolName ?? undefined,
    toolInput: parseToolInput(message.toolInput),
    toolCallId: message.toolCallId ?? undefined,
    costUsd: message.costUsd ?? undefined,
    inputTokens: message.inputTokens ?? undefined,
    outputTokens: message.outputTokens ?? undefined,
  };
}

function parseToolInput(toolInput: string | null): Record<string, unknown> | undefined {
  if (!toolInput) return undefined;

  try {
    const parsed = JSON.parse(toolInput);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Older rows may contain a plain string. Ignore it.
  }

  return undefined;
}

function sanitizeRestoredMessage(message: AgentMessage): AgentMessage | null {
  if (message.type === 'status') {
    return {
      ...message,
      statusKind: message.statusKind ?? 'diagnostic',
    };
  }

  if (message.role === 'system' && message.type === 'text') {
    if (isLegacyClaudeSpawnLine(message.content)) {
      return {
        ...message,
        type: 'status',
        statusKind: 'spawn',
      };
    }

    const legacyEvent = tryParseLegacyClaudeEvent(message.content);
    if (legacyEvent) {
      return sanitizeLegacyClaudeEvent(legacyEvent, message.timestamp);
    }
  }

  return message;
}

function isLegacyClaudeSpawnLine(content: string): boolean {
  return /^\[SSH\] Spawning claude on .+ \(cwd: .+\)$/.test(content.trim());
}

function sanitizeLegacyClaudeEvent(
  event: Record<string, unknown>,
  timestamp: number,
): AgentMessage | null {
  const type = typeof event.type === 'string' ? event.type : null;
  if (type === 'error') {
    const content = typeof event.message === 'string'
      ? event.message
      : typeof event.error === 'string'
        ? event.error
        : 'Claude reported an error';
    return {
      type: 'error',
      role: 'system',
      content,
      timestamp,
    };
  }

  if (type !== 'system') {
    return null;
  }

  const subtype = typeof event.subtype === 'string' ? event.subtype : null;
  if (subtype === 'hook_started') {
    const hookEvent = typeof event.hook_event === 'string'
      ? event.hook_event
      : typeof event.hookEvent === 'string'
        ? event.hookEvent
        : '';
    const hookName = typeof event.hook_name === 'string'
      ? event.hook_name
      : typeof event.hookName === 'string'
        ? event.hookName
        : '';

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

  if (subtype === 'hook_response') {
    return null;
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

  return null;
}

function tryParseLegacyClaudeEvent(content: string): Record<string, unknown> | null {
  const parsed = tryParseJsonRecord(content);
  if (!parsed) return null;
  return extractLegacyClaudeEvent(parsed);
}

function extractLegacyClaudeEvent(value: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof value.type === 'string') {
    return value;
  }

  for (const key of ['stdout', 'content', 'output']) {
    const nested = value[key];
    if (typeof nested !== 'string') continue;
    const parsed = tryParseJsonRecord(nested);
    if (!parsed) continue;
    const event = extractLegacyClaudeEvent(parsed);
    if (event) return event;
  }

  return null;
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore non-JSON content.
  }

  return null;
}
