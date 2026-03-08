import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList';
import { useChatStore } from '../../../stores/chat';

beforeEach(() => {
  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
});

describe('MessageList', () => {
  it('renders status messages as compact activity rows', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Claude startup',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');
    useChatStore.getState().addMessage('task-1', {
      type: 'status',
      role: 'system',
      statusKind: 'startup',
      content: 'Initializing Claude session',
      timestamp: 1,
    });

    render(<MessageList />);

    expect(screen.getByText('Initializing Claude session')).not.toBeNull();
    expect(document.querySelector('[data-status-kind="startup"]')).not.toBeNull();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });
});
