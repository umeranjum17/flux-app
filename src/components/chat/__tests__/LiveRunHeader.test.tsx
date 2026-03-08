import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveRunHeader } from '../LiveRunHeader';
import { useChatStore } from '../../../stores/chat';

beforeEach(() => {
  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
});

describe('LiveRunHeader', () => {
  it('renders active run details before assistant text arrives', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Task',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');

    render(<LiveRunHeader />);

    expect(screen.getByText('Codex')).not.toBeNull();
    expect(screen.getByText('Starting')).not.toBeNull();
  });
});
