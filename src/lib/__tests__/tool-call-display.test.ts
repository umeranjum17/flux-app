import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../types';
import { buildMergedToolResultLookup } from '../tool-call-display';

function message(partial: Partial<AgentMessage>): AgentMessage {
  return {
    type: 'text',
    role: 'assistant',
    content: '',
    timestamp: 0,
    ...partial,
  };
}

describe('buildMergedToolResultLookup', () => {
  it('associates tool results to calls across interleaved assistant text', () => {
    const messages: AgentMessage[] = [
      message({
        type: 'tool_call',
        role: 'assistant',
        timestamp: 1,
        toolName: 'bash',
        toolCallId: 'bash-1',
      }),
      message({
        type: 'text',
        role: 'assistant',
        timestamp: 2,
        content: 'Good! Let me inspect implementation details first.',
      }),
      message({
        type: 'tool_result',
        role: 'tool',
        timestamp: 3,
        toolCallId: 'bash-1',
        content: 'ok',
      }),
    ];

    const { mergedResultIndices, mergedResultForCall } = buildMergedToolResultLookup(messages);

    expect(mergedResultIndices.has(2)).toBe(true);
    expect(mergedResultForCall.get(0)?.toolCallId).toBe('bash-1');
    expect(mergedResultForCall.get(0)?.content).toBe('ok');
  });

  it('uses the latest tool call when a toolCallId repeats', () => {
    const messages: AgentMessage[] = [
      message({
        type: 'tool_call',
        role: 'assistant',
        timestamp: 1,
        toolName: 'bash',
        toolCallId: 'bash-1',
      }),
      message({
        type: 'tool_result',
        role: 'tool',
        timestamp: 2,
        toolCallId: 'bash-1',
        content: 'partial',
      }),
      message({
        type: 'tool_call',
        role: 'assistant',
        timestamp: 3,
        toolName: 'bash',
        toolCallId: 'bash-1',
      }),
      message({
        type: 'tool_result',
        role: 'tool',
        timestamp: 4,
        toolCallId: 'bash-1',
        content: 'final',
      }),
    ];

    const { mergedResultIndices, mergedResultForCall } = buildMergedToolResultLookup(messages);

    expect(mergedResultIndices.has(1)).toBe(true);
    expect(mergedResultIndices.has(3)).toBe(true);
    expect(mergedResultForCall.get(2)?.content).toBe('final');
    expect(mergedResultForCall.has(0)).toBe(true);
  });
});
