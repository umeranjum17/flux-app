import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '../chat';
import type { AgentMessage } from '../../lib/types';

function makeTask(id = 'task-1', options?: { workspaceId?: string; activate?: boolean }) {
  useChatStore.getState().createTask({
    id,
    title: 'Test task',
    agentId: 'claude-code',
    model: 'sonnet',
    mode: 'act',
    thinking: 'medium',
    cwd: '/tmp',
    workspaceId: options?.workspaceId,
    activate: options?.activate,
  });
}

beforeEach(() => {
  (window as any).api = {
    invoke: vi.fn().mockResolvedValue(undefined),
  };
  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
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

  it('can create a task without activating it', () => {
    makeTask('t1');
    makeTask('t2', { activate: false });
    expect(useChatStore.getState().activeTaskId).toBe('t1');
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

describe('removeTasksForWorkspace', () => {
  it('removes all tasks for a workspace and retargets the active task', () => {
    makeTask('ws-1-a', { workspaceId: 'ws-1' });
    makeTask('standalone');
    makeTask('ws-1-b', { workspaceId: 'ws-1' });

    useChatStore.getState().removeTasksForWorkspace('ws-1');

    expect(useChatStore.getState().tasks.has('ws-1-a')).toBe(false);
    expect(useChatStore.getState().tasks.has('ws-1-b')).toBe(false);
    expect(useChatStore.getState().tasks.has('standalone')).toBe(true);
    expect(useChatStore.getState().tabOrder).toEqual(['standalone']);
    expect(useChatStore.getState().activeTaskId).toBe('standalone');
  });

  it('keeps the current task when removing a different workspace', () => {
    makeTask('ws-1-a', { workspaceId: 'ws-1' });
    makeTask('standalone');

    useChatStore.getState().removeTasksForWorkspace('ws-1');

    expect(useChatStore.getState().activeTaskId).toBe('standalone');
    expect(useChatStore.getState().tasks.has('standalone')).toBe(true);
  });
});

describe('switchTaskAgent', () => {
  it('can update the task selection without stopping the active run', () => {
    makeTask('running-task');
    useChatStore.getState().setTaskStatus('running-task', 'running');

    useChatStore.getState().switchTaskAgent('running-task', 'codex', 'gpt-5.4', { stopActiveRun: false });

    const task = useChatStore.getState().tasks.get('running-task')!;
    expect(task.agentId).toBe('codex');
    expect(task.model).toBe('gpt-5.4');
    expect((window as any).api.invoke).not.toHaveBeenCalledWith('task:stop', { taskId: 'running-task' });
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

  it('promotes status from done when a new live message arrives', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('promotes status from error when a new live message arrives', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'error');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('does NOT promote status from running (stays running)', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'running');
    useChatStore.getState().addMessage('t1', textMsg);
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('keeps task done when receiving a result message', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');
    useChatStore.getState().addMessage('t1', {
      type: 'result',
      role: 'assistant',
      content: 'Completed',
      timestamp: Date.now(),
    });

    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('done');
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

  it('tracks the latest rate limit info for the task', () => {
    makeTask('t1');
    useChatStore.getState().addMessage('t1', {
      type: 'rate_limit',
      role: 'system',
      content: 'rate',
      timestamp: Date.now(),
      rateLimitInfo: {
        status: 'allowed_warning',
        resetsAt: Date.now() + 60_000,
        rateLimitType: 'claude',
        utilization: 0.72,
      },
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.rateLimitInfo?.utilization).toBe(0.72);
  });

  it('tracks the latest quality gate result for the task', () => {
    makeTask('t1');
    useChatStore.getState().addMessage('t1', {
      type: 'quality_gate',
      role: 'system',
      content: 'Quality gate failed: npm run typecheck',
      timestamp: Date.now(),
      command: 'npm run typecheck',
      exitCode: 2,
      passed: false,
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.lastQualityGate).toEqual({
      status: 'failed',
      command: 'npm run typecheck',
      exitCode: 2,
    });
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().addMessage('nonexistent', textMsg);
    // should not throw
    expect(useChatStore.getState().tasks.size).toBe(0);
  });

  it('merges streamed assistant text chunks into one message', () => {
    makeTask('t1');
    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'text',
      role: 'assistant',
      content: 'Hel',
      timestamp: 1,
    });
    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'text',
      role: 'assistant',
      content: 'lo',
      timestamp: 2,
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.messages).toHaveLength(1);
    expect(task.messages[0].content).toBe('Hello');
  });

  it('does not merge streamed chunks across message types', () => {
    makeTask('t1');
    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'text',
      role: 'assistant',
      content: 'Thinking...',
      timestamp: 1,
    });
    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'thinking',
      role: 'assistant',
      content: 'Reasoning',
      timestamp: 2,
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.messages).toHaveLength(2);
    expect(task.messages[0].type).toBe('text');
    expect(task.messages[1].type).toBe('thinking');
  });
});

describe('restoreMessages', () => {
  it('rehydrates history without reviving a completed task', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');

    useChatStore.getState().restoreMessages('t1', [
      {
        type: 'text',
        role: 'assistant',
        content: 'Here is the plan.',
        timestamp: 1,
      },
      {
        type: 'tool_call',
        role: 'assistant',
        content: 'Edited file',
        timestamp: 2,
        toolName: 'Edit',
        toolInput: { path: '/tmp/src/app.ts' },
        diff: '--- a/src/app.ts\n+++ b/src/app.ts\n+const next = true;',
      },
      {
        type: 'result',
        role: 'assistant',
        content: 'Done',
        timestamp: 3,
        costUsd: 0.12,
        inputTokens: 1200,
        outputTokens: 300,
      },
    ]);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('done');
    expect(task.activeRun).toBeUndefined();
    expect(task.messages).toHaveLength(3);
    expect(task.costUsd).toBeCloseTo(0.12);
    expect(task.inputTokens).toBe(1200);
    expect(task.outputTokens).toBe(300);
    expect(task.editedFiles.get('src/app.ts')).toMatchObject({
      filePath: 'src/app.ts',
      additions: 1,
      deletions: 0,
    });
  });

  it('ignores ephemeral live-only messages during restore', () => {
    makeTask('t1');

    useChatStore.getState().restoreMessages('t1', [
      {
        type: 'status',
        role: 'system',
        content: 'Working',
        timestamp: 1,
        statusKind: 'progress',
      },
      {
        type: 'rate_limit',
        role: 'system',
        content: 'rate',
        timestamp: 2,
        rateLimitInfo: {
          status: 'allowed_warning',
          resetsAt: Date.now() + 60_000,
          rateLimitType: 'claude',
          utilization: 0.9,
        },
      },
    ]);

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.messages).toEqual([]);
    expect(task.status).toBe('idle');
    expect(task.currentStatus).toBeUndefined();
    expect(task.rateLimitInfo).toBeUndefined();
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

  it('allows restarting from done', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'done');
    useChatStore.getState().setTaskStatus('t1', 'running');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('allows restarting from error', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'error');
    useChatStore.getState().setTaskStatus('t1', 'running');
    expect(useChatStore.getState().tasks.get('t1')!.status).toBe('running');
  });

  it('no-ops for a nonexistent task', () => {
    useChatStore.getState().setTaskStatus('nonexistent', 'running');
    expect(useChatStore.getState().tasks.size).toBe(0);
  });

  it('marks all todo items done when task completes', () => {
    makeTask('t1');
    useChatStore.getState().setTodoItems('t1', [
      { id: 1, label: 'Prepare', status: 'done' },
      { id: 2, label: 'Merge', status: 'in_progress' },
      { id: 3, label: 'Verify', status: 'pending' },
    ]);

    useChatStore.getState().setTaskStatus('t1', 'done');

    expect(useChatStore.getState().tasks.get('t1')!.todoItems).toEqual([
      { id: 1, label: 'Prepare', status: 'done' },
      { id: 2, label: 'Merge', status: 'done' },
      { id: 3, label: 'Verify', status: 'done' },
    ]);
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

describe('question requests and live run state', () => {
  it('tracks pending questions and switches the task to waiting_input', () => {
    makeTask('t1');
    useChatStore.getState().setTaskStatus('t1', 'running');

    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'question_request',
      role: 'assistant',
      content: 'Which area should I fix first?',
      timestamp: 10,
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

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('waiting_input');
    expect(task.pendingQuestion).toEqual({
      requestId: 'q-1',
      prompt: 'Which area should I fix first?',
      questions: [{
        header: 'Priority',
        question: 'Which area should I fix first?',
        options: [{ label: 'Backend first' }, { label: 'UI first' }],
        allowFreeform: false,
      }],
      options: [{ label: 'Backend first' }, { label: 'UI first' }],
      allowFreeform: false,
      placeholder: undefined,
    });
    expect(task.activeRun?.phase).toBe('waiting_input');
  });

  it('clears pending questions and resumes running after a user answer arrives', () => {
    makeTask('t1');
    useChatStore.getState().setPendingQuestion('t1', {
      requestId: 'q-1',
      prompt: 'Which area should I fix first?',
      questions: [{
        question: 'Which area should I fix first?',
        allowFreeform: true,
      }],
      allowFreeform: true,
    });

    useChatStore.getState().ingestStreamMessage('t1', {
      type: 'text',
      role: 'user',
      content: 'Backend first',
      timestamp: 11,
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('running');
    expect(task.pendingQuestion).toBeUndefined();
    expect(task.activeRun?.phase).toBe('progress');
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

  it('includes attachments when provided', () => {
    makeTask('t1');
    useChatStore.getState().addUserMessage('t1', 'See file', undefined, [
      { path: '/tmp/a.ts', name: 'a.ts' },
    ]);

    const msg = useChatStore.getState().tasks.get('t1')!.messages[0];
    expect(msg.attachments).toEqual([{ path: '/tmp/a.ts', name: 'a.ts' }]);
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

describe('todo updates', () => {
  it('upserts missing steps when receiving incremental todo updates', () => {
    makeTask('t1');
    useChatStore.getState().setTodoItems('t1', [
      { id: 1, label: 'Step 1', status: 'done' },
    ]);

    useChatStore.getState().updateTodoItem('t1', 3, 'in_progress', 'Step 3');
    useChatStore.getState().updateTodoItem('t1', 2, 'pending');

    expect(useChatStore.getState().tasks.get('t1')!.todoItems).toEqual([
      { id: 1, label: 'Step 1', status: 'done' },
      { id: 2, label: 'Step 2', status: 'pending' },
      { id: 3, label: 'Step 3', status: 'in_progress' },
    ]);
  });

  it('completes todos when a result message arrives', () => {
    makeTask('t1');
    useChatStore.getState().setTodoItems('t1', [
      { id: 1, label: 'Merge commits', status: 'in_progress' },
      { id: 2, label: 'Push status', status: 'pending' },
    ]);

    useChatStore.getState().addMessage('t1', {
      type: 'result',
      role: 'assistant',
      content: 'Done',
      timestamp: Date.now(),
    });

    const task = useChatStore.getState().tasks.get('t1')!;
    expect(task.status).toBe('done');
    expect(task.todoItems).toEqual([
      { id: 1, label: 'Merge commits', status: 'done' },
      { id: 2, label: 'Push status', status: 'done' },
    ]);
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

describe('updateWorkspaceTaskCwd', () => {
  it('updates cwd for all tasks in the target workspace', () => {
    makeTask('ws-1-a', { workspaceId: 'ws-1' });
    makeTask('ws-1-b', { workspaceId: 'ws-1' });
    makeTask('ws-2-a', { workspaceId: 'ws-2' });

    useChatStore.getState().updateWorkspaceTaskCwd('ws-1', '/repo/.flux-worktrees/fix-rename');

    expect(useChatStore.getState().tasks.get('ws-1-a')?.cwd).toBe('/repo/.flux-worktrees/fix-rename');
    expect(useChatStore.getState().tasks.get('ws-1-b')?.cwd).toBe('/repo/.flux-worktrees/fix-rename');
    expect(useChatStore.getState().tasks.get('ws-2-a')?.cwd).toBe('/tmp');
  });
});
