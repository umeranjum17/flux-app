import { EventEmitter } from 'events';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spawnCodex } from '../codex';
import { spawnAgentProcess } from '../spawn-utils';

vi.mock('../spawn-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spawn-utils')>();
  return {
    ...actual,
    spawnAgentProcess: vi.fn(),
  };
});

class FakeReadable extends EventEmitter {}

class FakeWritable {
  writable = true;
  writes: string[] = [];

  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeReadable();
  stderr = new FakeReadable();
  stdin = new FakeWritable();
  kill = vi.fn();
}

function emitStdout(proc: FakeChildProcess, event: Record<string, unknown>): void {
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`, 'utf-8'));
}

describe('spawnCodex', () => {
  const mockedSpawnAgentProcess = vi.mocked(spawnAgentProcess);

  beforeEach(() => {
    mockedSpawnAgentProcess.mockReset();
  });

  it('maps codex commentary, reasoning, tool calls, tool results, and rate limits', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message: 'Checking the workspace state',
      },
    });
    emitStdout(proc, {
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: 'I should inspect the task store first.',
      },
    });
    emitStdout(proc, {
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ text: 'Need to handle question prompts before UI changes.' }],
      },
    });
    emitStdout(proc, {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'tool-1',
        name: 'read_file',
        input: { path: 'src/stores/chat.ts' },
      },
    });
    emitStdout(proc, {
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'tool-1',
        output: 'file contents',
      },
    });
    emitStdout(proc, {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_name: 'five_hour',
          primary: {
            used_percent: 85,
            resets_at: 1_777_301_080,
          },
        },
      },
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'status',
        statusKind: 'progress',
        content: 'Checking the workspace state',
      }),
      expect.objectContaining({
        type: 'thinking',
        content: 'I should inspect the task store first.',
      }),
      expect.objectContaining({
        type: 'thinking',
        content: 'Need to handle question prompts before UI changes.',
      }),
      expect.objectContaining({
        type: 'tool_call',
        toolName: 'read_file',
        toolCallId: 'tool-1',
      }),
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'tool-1',
        content: 'file contents',
      }),
      expect.objectContaining({
        type: 'rate_limit',
        rateLimitInfo: expect.objectContaining({
          utilization: 0.85,
          status: 'allowed_warning',
        }),
      }),
    ]);
  });

  it('maps request_user_input calls into question requests', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'question-1',
        name: 'request_user_input',
        arguments: JSON.stringify({
          questions: [{
            header: 'Direction',
            question: 'Which path should I take?',
            options: [
              { label: 'UI first', description: 'Implement the renderer surface now' },
              { label: 'Backend first', description: 'Fix adapters before UI' },
            ],
            multiSelect: false,
          }],
        }),
      },
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'question_request',
        requestId: 'question-1',
        content: 'Which path should I take?',
        questions: [
          expect.objectContaining({
            header: 'Direction',
            question: 'Which path should I take?',
            multiSelect: false,
          }),
        ],
      }),
    ]);
  });

  it('answers questions by steering the response back into stdin', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'act',
      cwd: '/workspace',
    });

    handle.answerQuestion('question-1', 'Backend first');

    expect(proc.stdin.writes.at(-1)).toBe('Backend first\n');
  });

  it('uses the detected remote Codex binary when available over SSH', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'act',
      cwd: '/tmp/flux-local',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
      binaryPath: '/opt/tools/codex',
    });

    expect(mockedSpawnAgentProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: '/opt/tools/codex',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
    }));
  });

  it('keeps resume flags before session id and prompt in plan mode', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'plan',
      cwd: '/workspace',
      resumeSessionId: 'session-123',
    });

    const args = mockedSpawnAgentProcess.mock.calls[0]?.[0]?.args ?? [];
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args).not.toContain('--sandbox');
    expect(args.indexOf('--json')).toBeGreaterThan(-1);
    expect(args.indexOf('--json')).toBeLessThan(args.indexOf('session-123'));
    expect(args.indexOf('session-123')).toBeLessThan(args.length - 1);
  });

  it('preserves read-only sandbox for fresh plan sessions', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    spawnCodex({
      taskId: 'task-1',
      prompt: 'ship it',
      mode: 'plan',
      cwd: '/workspace',
    });

    const args = mockedSpawnAgentProcess.mock.calls[0]?.[0]?.args ?? [];
    const sandboxIndex = args.indexOf('--sandbox');
    expect(sandboxIndex).toBeGreaterThan(-1);
    expect(args[sandboxIndex + 1]).toBe('read-only');
  });

  it('skips local image temp files when Codex runs over SSH and emits a warning', () => {
    vi.useFakeTimers();
    try {
      const proc = new FakeChildProcess();
      mockedSpawnAgentProcess.mockReturnValue(proc as any);

      const handle = spawnCodex({
        taskId: 'task-1',
        prompt: 'ship it',
        mode: 'act',
        cwd: '/tmp/flux-local',
        sshHost: 'umera@extreme',
        remoteCwd: '/remote/workspace',
        images: ['data:image/png;base64,aGVsbG8='],
      });

      const messages: any[] = [];
      handle.on('message', (message) => messages.push(message));

      const args = mockedSpawnAgentProcess.mock.calls[0]?.[0]?.args ?? [];
      expect(args).not.toContain('--image');

      vi.runAllTimers();

      expect(messages).toContainEqual(expect.objectContaining({
        type: 'text',
        role: 'system',
        content: 'Codex image attachments are not supported over SSH yet. They were skipped.',
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
