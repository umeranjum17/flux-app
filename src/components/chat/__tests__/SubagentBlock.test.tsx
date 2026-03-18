import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubagentState } from '../../../lib/types';
import { SubagentBlock } from '../SubagentBlock';

afterEach(() => {
  cleanup();
});

function makeState(): SubagentState {
  return {
    name: 'Research helper',
    status: 'done',
    toolCount: 4,
    inputTokens: 0,
    outputTokens: 0,
    messages: [
      {
        type: 'tool_call',
        role: 'assistant',
        content: 'Calling report_intent',
        timestamp: 1,
        toolName: 'report_intent',
        toolInput: { intent: 'Exploring files' },
        toolCallId: 'intent-1',
      },
      {
        type: 'tool_call',
        role: 'assistant',
        content: 'Calling Read',
        timestamp: 2,
        toolName: 'Read',
        toolInput: { path: 'src/example.ts' },
        toolCallId: 'read-1',
      },
      {
        type: 'tool_result',
        role: 'tool',
        content: 'const example = true;',
        timestamp: 3,
        toolCallId: 'read-1',
      },
      {
        type: 'tool_call',
        role: 'assistant',
        content: 'Calling Glob',
        timestamp: 4,
        toolName: 'Glob',
        toolInput: { pattern: 'src/**/*.ts' },
        toolCallId: 'glob-1',
      },
      {
        type: 'tool_result',
        role: 'tool',
        content: '["src/example.ts"]',
        timestamp: 5,
        toolCallId: 'glob-1',
      },
      {
        type: 'tool_call',
        role: 'assistant',
        content: 'Calling Edit',
        timestamp: 6,
        toolName: 'Edit',
        toolInput: { path: 'src/example.ts', old_string: 'true', new_string: 'false' },
        toolCallId: 'edit-1',
      },
      {
        type: 'tool_result',
        role: 'tool',
        content: 'Applied edit',
        timestamp: 7,
        toolCallId: 'edit-1',
      },
    ],
  };
}

describe('SubagentBlock', () => {
  it('groups routine tool calls and hides low-signal tool rows', async () => {
    const user = userEvent.setup();
    render(
      <SubagentBlock
        subagents={[{ id: 'sub-1', state: makeState() }]}
        stage="finished"
        taskMode="act"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Agent Research helper/i }));

    expect(screen.queryByText('Report intent')).toBeNull();
    expect(screen.getByText('Tool activity')).not.toBeNull();
    expect(screen.getByText('Read')).not.toBeNull();
    expect(screen.getByText('Glob')).not.toBeNull();
    expect(screen.getByText('Edit')).not.toBeNull();
    expect(screen.queryByText('src/example.ts (1 lines)')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Tool activity/i }));

    expect(screen.getByText('src/example.ts (1 lines)')).not.toBeNull();
    expect(screen.getByText('src/**/*.ts · 1 files')).not.toBeNull();
  });
});
