import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chat';
import type { AgentMessage } from '../../lib/types';

function makeTask(id = 'task-1') {
  useChatStore.getState().createTask({
    id,
    title: 'Test task',
    agentId: 'claude-code',
    model: 'sonnet',
    mode: 'act',
    thinking: 'medium',
    cwd: '/tmp',
  });
}

beforeEach(() => {
  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
});

describe('createTask', () => {
  it('creates a task with correct defaults', () => {
    makeTask('t1');
    const task = useChatStore.getState().tasks.get('t1');
    expect(task).toBeDefined();
    expect(task!.status).toBe('idle');
    expect(task!.messages).toEqual([]);
    expect(task!.costUsd).toBe(0);
    expect(task!.inputTokens).toBe(0);
    expect(task!.outputTokens).toBe(0);
    expect(task!.title).toBe('Test task');
    expect(task!.agentId).toBe('claude-code');
    expect(task!.model).toBe('sonnet');
    expect(task!.mode).toBe('act');
    expect(task!.thinking).toBe('medium');
    expect(task!.cwd).toBe('/tmp');
  });

  it('sets activeTaskId to the newly created task', () => {
    makeTask('t1');
    expect(useChatStore.getState().activeTaskId).toBe('t1');

    makeTask('t2');
    expect(useChatStore.getState().activeTaskId).toBe('t2');
  });
});

describe('removeTask', () => {
  it('removes the task from the map', () => {
    makeTask('t1');
    useChatStore.getState().removeTask('t1');
    expect(useChatStore.getState().tasks.has('t1')).toBe(false);
  });

  it('sets activeTaskId to the last remaining task when active is removed', () => {
    makeTask('t1');
    makeTask('t2');
    makeTask('t3');
    // active is t3, remove it
    useChatStore.getState().removeTask('t3');
    expect(useChatStore.getState().activeTaskId).toBe('t2');
  });

  it('sets activeTaskId to null when no tasks remain', () => {
    makeTask('t1');
    useChatStore.getState().removeTask('t1');
    expect(useChatStore.getState().activeTaskId).toBeNull();
  });

  it('does not change activeTaskId when a non-active task is removed', () => {
    makeTask('t1');
    makeTask('t2');
    // active is t2
    useChatStore.getState().removeTask('t1');
    expect(useChatStore.getState().activeTaskId).toBe('t2');
  });
});

describe('addMessage', () => {
  const textMsg: AgentMessage = {
    type: 'text',
    role: 'assistant',
    content: 'Hello',
    timestamp: Date.now(),
  };

  it('appends a message to the correct task', () => {
    makeTask('t1');
    makeTask('t2');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.messages).toHaveLength(1);
    expect(useChatStore.getState().tasks.get('t1')!.messages[0].content).toBe('Hello');
    expect(useChatStore.getState().tasks.get('t2')!.messages).toHaveLength(0);
  });

  it('promotes status from idle to running', () => {
    makeTask('t1');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('idle');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('does NOT promote status from done', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('done');
  });

  it('does NOT promote status from error', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'error');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('error');
  });

  it('does NOT promote status from running (stays running)', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'running');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('accumulates cost and tokens from result messages', () => {
    makeTask('t1');
    const resultMsg: AgentMessage = {
      type: 'result',
      role: 'assistant',
      content: 'Done',
      timestamp: Date.now(),
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
    };
    useChatStore.getState().addMessage('t1', resultMsg);
    useChatStore.getState().addMessage('t1', resultMsg);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.costUsd).toBeCloseTo(0.10);
    expect(task.inputTokens).toBe(2000);
    expect(task.outputTokens).toBe(1000);
  });

  it('does not accumulate tokens from non-result messages', () => {
    makeTask('t1');
    useChatStore.getState().addMessage('t1', textMsg);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.costUsd).toBe(0);
    expect(task.inputTokens).toBe(0);
    expect(task.outputTokens).toBe(0);
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().addMessage('nonexistent', textMsg);
    // should not throw
    expect(useChatStore.getState().tasks.size).toBe(0);
  });
});

describe('setTaskStatus', () => {
  it('sets the status correctly', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'running');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');

    useChatStore.getState().setTaskStatus('t1', 'waiting_approval');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('waiting_approval');
  });

  it('does NOT regress from done', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');
    useChatStore.getState().setTaskStatus('t1', 'running');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('done');
  });

  it('does NOT regress from error', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'error');
    useChatStore.getState().setTaskStatus('t1', 'running');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('error');
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().setTaskStatus('nonexistent', 'running');
    expect(useChatStore.getState().tasks.size).toBe(0);
  });
});

describe('setPendingApproval', () => {
  const approval = {
    requestId: 'req-1',
    toolName: 'bash',
    description: 'Run rm -rf /',
    action: 'execute',
    path: '/tmp/test.sh',
  };

  it('sets approval and status to waiting_approval', () => {
    makeTask('t1');
    useChatStore.getState().setPendingApproval('t1', approval);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('waiting_approval');
    expect(task.pendingApproval).toEqual(approval);
  });

  it('clears approval and sets status to running when passed null', () => {
    makeTask('t1');
    useChatStore.getState().setPendingApproval('t1', approval);
    useChatStore.getState().setPendingApproval('t1', null);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('running');
    expect(task.pendingApproval).toBeUndefined();
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().setPendingApproval('nonexistent', approval);
    expect(useChatStore.getState().tasks.size).toBe(0);
  });
});

describe('addUserMessage', () => {
  it('adds a message with role user and correct content', () => {
    makeTask('t1');
    useChatStore.getState().addUserMessage('t1', 'Fix the bug');

    const msgs = useChatStore.getState().tasks.get('t1')!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].type).toBe('text');
    expect(msgs[0].content).toBe('Fix the bug');
    expect(msgs[0].timestamp).toBeTypeOf('number');
  });

  it('includes images when provided', () => {
    makeTask('t1');
    useChatStore.getState().addUserMessage('t1', 'See image', ['/tmp/a.png', '/tmp/b.png']);

    const msg = useChatStore.getState().tasks.get('t1')!.messages[0];
    expect(msg.images).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  it('does not include images key when no images provided', () => {
    makeTask('t1');
    useChatStore.getState().addUserMessage('t1', 'No images');

    const msg = useChatStore.getState().tasks.get('t1')!.messages[0];
    expect(msg.images).toBeUndefined();
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().addUserMessage('nonexistent', 'Hello');
    expect(useChatStore.getState().tasks.size).toBe(0);
  });
});

describe('getActiveTask', () => {
  it('returns the active task', () => {
    makeTask('t1');
    makeTask('t2');
    useChatStore.getState().setActiveTask('t1');

    const active = useChatStore.getState().getActiveTask();
    expect(active).toBeDefined();
    expect(active!.id).toBe('t1');
  });

  it('returns undefined when no tasks exist', () => {
    expect(useChatStore.getState().getActiveTask()).toBeUndefined();
  });

  it('returns undefined when activeTaskId is null', () => {
    makeTask('t1');
    useChatStore.setState({ activeTaskId: null });
    expect(useChatStore.getState().getActiveTask()).toBeUndefined();
  });
});
