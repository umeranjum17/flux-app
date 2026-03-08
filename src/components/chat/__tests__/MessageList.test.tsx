import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList';
import { useChatStore } from '../../../stores/chat';

beforeEach(() => {
  cleanup();
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

  it('renders question requests inline', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Question',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'waiting_input');
    useChatStore.getState().addMessage('task-1', {
      type: 'question_request',
      role: 'assistant',
      content: 'Which area should I fix first?',
      timestamp: 2,
      requestId: 'q-1',
      questions: [{
        header: 'Priority',
        question: 'Which area should I fix first?',
        options: [{ label: 'Backend first' }, { label: 'UI first' }],
        allowFreeform: false,
      }],
      options: [{ label: 'Backend first' }, { label: 'UI first' }],
      allowFreeform: false,
    });

    render(<MessageList />);

    expect(screen.getAllByText('Input requested').length).toBeGreaterThan(0);
    expect(screen.getByText('Backend first')).not.toBeNull();
    expect(screen.getByText('UI first')).not.toBeNull();
  });

  it('keeps active thinking expanded while a task is live', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Thinking',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');
    useChatStore.getState().addMessage('task-1', {
      type: 'thinking',
      role: 'assistant',
      content: 'Line 1\nLine 2',
      timestamp: 3,
    });

    render(<MessageList />);

    expect(screen.getByText(/Line 1/)).not.toBeNull();
    expect(screen.getByText(/Line 2/)).not.toBeNull();
  });
});
