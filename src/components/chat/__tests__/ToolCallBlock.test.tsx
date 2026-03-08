import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallBlock } from '../ToolCallBlock';

describe('ToolCallBlock', () => {
  it('renders TodoWrite payloads as a checklist instead of raw JSON', () => {
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

    expect(screen.getByText('1 out of 3 tasks completed')).not.toBeNull();
    expect(screen.getByText('Inspect shared types')).not.toBeNull();
    expect(screen.getByText('Implement question propagation')).not.toBeNull();
    expect(screen.queryByText(/\{/)).toBeNull();
  });
});
