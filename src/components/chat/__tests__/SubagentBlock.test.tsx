import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubagentBlock } from '../SubagentBlock';

afterEach(() => {
  cleanup();
});

describe('SubagentBlock', () => {
  it('groups consecutive tool calls inside an expanded subagent transcript', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <SubagentBlock
        taskMode="act"
        subagents={[
          {
            id: 'subagent-1',
            state: {
              name: 'Research helper',
              status: 'done',
              toolCount: 2,
              inputTokens: 0,
              outputTokens: 0,
              messages: [
                {
                  type: 'tool_call',
                  role: 'assistant',
                  content: 'Using tool: glob',
                  timestamp: 1,
                  toolName: 'glob',
                  toolInput: { pattern: 'src/**/*.tsx' },
                  toolCallId: 'tool-1',
                },
                {
                  type: 'tool_result',
                  role: 'tool',
                  content: 'src/components/chat/MessageList.tsx',
                  timestamp: 2,
                  toolCallId: 'tool-1',
                },
                {
                  type: 'tool_call',
                  role: 'assistant',
                  content: 'Using tool: view',
                  timestamp: 3,
                  toolName: 'view',
                  toolInput: { path: '/workspace/src/components/chat/MessageList.tsx' },
                  toolCallId: 'tool-2',
                },
                {
                  type: 'tool_result',
                  role: 'tool',
                  content: '1. export function MessageList() {}',
                  timestamp: 4,
                  toolCallId: 'tool-2',
                },
              ],
            },
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Agent/i }));

    expect(container.querySelectorAll('[data-tool-call-group]').length).toBe(1);
    expect(screen.getByText(/2 calls/i)).not.toBeNull();
  });
});
