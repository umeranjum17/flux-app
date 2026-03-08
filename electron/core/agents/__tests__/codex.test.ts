import { EventEmitter } from 'events';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spawnCodex } from '../codex';
import { spawnAgentProcess } from '../spawn-utils';

vi.mock('../spawn-utils', () => ({
  spawnAgentProcess: vi.fn(),
}));

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
});
