import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallBlock } from '../ToolCallBlock';

describe('ToolCallBlock', () => {
  it('renders TodoWrite payloads as a checklist instead of raw JSON', async () => {
    const user = userEvent.setup();
    render(
      <ToolCallBlock
        toolName="TodoWrite"
        content="Using tool: TodoWrite"
        toolInput={{
          todos: [
            { content: 'Inspect shared types', status: 'completed' },
            { content: 'Implement question propagation', status: 'in_progress', activeForm: 'Implementing question propagation' },
            { content: 'Update renderer todo card', status: 'pending' },
          ],
        }}
      />,
    );

    expect(screen.getByText('1/3 completed')).not.toBeNull();
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('Inspect shared types')).not.toBeNull();
    expect(screen.getByText('Implement question propagation')).not.toBeNull();
    expect(screen.queryByText(/\{/)).toBeNull();
  });
});
