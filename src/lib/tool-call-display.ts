import type { AgentMessage } from './types';

export type ToolCallDisplayTier = 'hidden' | 'routine' | 'important';
export type ToolCallImportance = Exclude<ToolCallDisplayTier, 'hidden'>;

export function formatToolCallLabel(toolName: string): string {
  return toolName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function isFileEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.includes('edit') || name.includes('write') || name.includes('patch');
}

function hasStructuredTodoPayload(toolName: string, toolInput?: Record<string, unknown>): boolean {
  if (!toolInput) return false;
  const lowerToolName = toolName.toLowerCase();
  return lowerToolName.includes('todo')
    || lowerToolName === 'update_plan'
    || Array.isArray(toolInput.todos)
    || Array.isArray(toolInput.plan);
}

function hasStructuredQuestionPayload(toolName: string, toolInput?: Record<string, unknown>): boolean {
  if (!toolInput) return false;
  const lowerToolName = toolName.toLowerCase();
  return lowerToolName.includes('question')
    || lowerToolName.includes('request_user_input')
    || Array.isArray(toolInput.questions);
}

export function getToolCallDisplayTier(
  message: AgentMessage,
  mergedResult?: AgentMessage | null,
): ToolCallDisplayTier {
  if (message.type !== 'tool_call') {
    return 'important';
  }

  const toolName = message.toolName ?? 'unknown';
  const lowerToolName = toolName.toLowerCase();

  if (hasStructuredTodoPayload(toolName, message.toolInput)) {
    return 'hidden';
  }

  if (lowerToolName === 'report_intent' || lowerToolName.endsWith('.report_intent')) {
    return 'hidden';
  }

  if (mergedResult?.isError) {
    return 'important';
  }

  if (isFileEditToolName(toolName) || Boolean(message.diff) || Boolean(message.filePath)) {
    return 'important';
  }

  if (hasStructuredQuestionPayload(toolName, message.toolInput)) {
    return 'important';
  }

  return 'routine';
}

export function buildMergedToolResultLookup(messages: AgentMessage[]): {
  mergedResultIndices: Set<number>;
  mergedResultForCall: Map<number, AgentMessage>;
} {
  const mergedResultIndices = new Set<number>();
  const mergedResultForCall = new Map<number, AgentMessage>();

  for (let i = 0; i < messages.length - 1; i++) {
    const message = messages[i];
    if (message.type !== 'tool_call' || !message.toolCallId) continue;

    for (let j = i + 1; j < messages.length; j++) {
      const candidate = messages[j];
      if (candidate.type === 'status' && candidate.toolCallId === message.toolCallId) continue;
      if (candidate.type === 'tool_result' && candidate.toolCallId === message.toolCallId) {
        mergedResultIndices.add(j);
        mergedResultForCall.set(i, candidate);
      }
      break;
    }
  }

  return { mergedResultIndices, mergedResultForCall };
}
