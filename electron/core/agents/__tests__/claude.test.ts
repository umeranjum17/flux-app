import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_STARTUP_TIMEOUT_MS, spawnClaude } from '../claude';
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

describe('spawnClaude', () => {
  const mockedSpawnAgentProcess = vi.mocked(spawnAgentProcess);

  beforeEach(() => {
    vi.useFakeTimers();
    mockedSpawnAgentProcess.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns Claude in print + stream-json mode and sends the initial prompt over stdin', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
      binaryPath: '/usr/bin/claude',
    });

    expect(mockedSpawnAgentProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: '/usr/bin/claude',
      cwd: '/workspace',
      args: expect.arrayContaining([
        '-p',
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--permission-prompt-tool', 'stdio',
        '--no-chrome',
        '--include-partial-messages',
        '--verbose',
        '--model', 'sonnet',
        '--effort', 'medium',
      ]),
    }));

    const args = mockedSpawnAgentProcess.mock.calls[0]?.[0]?.args ?? [];
    expect(args).not.toContain('hi');

    expect(JSON.parse(proc.stdin.writes[0])).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
      },
    });
  });

  it('emits an SSH spawn status and forwards SSH spawn options', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/tmp/flux-local',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    vi.advanceTimersByTime(0);

    expect(mockedSpawnAgentProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: 'claude',
      cwd: '/tmp/flux-local',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'status',
      statusKind: 'spawn',
      content: '[SSH] Spawning claude on umera@extreme (cwd: /remote/workspace)',
    }));
  });

  it('uses the detected remote Claude binary when available over SSH', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/tmp/flux-local',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
      binaryPath: '/opt/tools/claude',
    });

    expect(mockedSpawnAgentProcess).toHaveBeenCalledWith(expect.objectContaining({
      command: '/opt/tools/claude',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
    }));
  });

  it('uses the same stdin protocol for steer, approve, and deny', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    handle.steer('follow up');
    handle.approve('req-1');
    handle.deny('req-2');

    expect(JSON.parse(proc.stdin.writes[1])).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'follow up' }],
      },
    });
    expect(JSON.parse(proc.stdin.writes[2])).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow' },
      },
    });
    expect(JSON.parse(proc.stdin.writes[3])).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-2',
        response: { behavior: 'deny', message: 'User denied permission' },
      },
    });
  });

  it('maps startup hooks to compact status messages and suppresses raw hook payload dumps', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'system',
      subtype: 'hook_started',
      hook_event: 'SessionStart',
      hook_name: 'SessionStart:startup',
      session_id: 'session-1',
    });
    emitStdout(proc, {
      type: 'system',
      subtype: 'hook_response',
      hook_event: 'SessionStart',
      hook_name: 'SessionStart:startup',
      output: '{ huge json dump }',
      session_id: 'session-1',
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'status',
        statusKind: 'startup',
        content: 'Initializing Claude session',
      }),
    ]);
  });

  it('maps AskUserQuestion tool use into a question request and responds with tool_result input', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_123',
          name: 'AskUserQuestion',
          input: {
            questions: [{
              header: 'Scope',
              question: 'Do you want UI or backend changes first?',
              options: [
                { label: 'UI first', description: 'Prioritize the renderer path' },
                { label: 'Backend first', description: 'Fix the adapters before UI polish' },
              ],
              multiSelect: false,
            }],
          },
        }],
      },
    });

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'question_request',
        requestId: 'toolu_123',
        content: 'Do you want UI or backend changes first?',
      }),
    ]);

    handle.answerQuestion('toolu_123', '"Do you want UI or backend changes first?" = Backend first');

    expect(JSON.parse(proc.stdin.writes.at(-1)!)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_123',
          content: 'User has answered your questions: "Do you want UI or backend changes first?" = Backend first. You can now continue with the user\'s answers in mind.',
        }],
      },
    });
  });

  it('maps user events with tool_result content blocks', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_abc',
          content: [{ type: 'text', text: 'File contents here' }],
        }],
      },
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      role: 'tool',
      content: 'File contents here',
      toolCallId: 'toolu_abc',
      isError: false,
    }));
  });

  it('normalizes structured content arrays in tool_result to plain text', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'tool_result',
      tool_use_id: 'toolu_xyz',
      content: [
        { type: 'text', text: 'Line 1' },
        { type: 'text', text: 'Line 2' },
      ],
    });

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'tool_result',
      content: 'Line 1\nLine 2',
      toolCallId: 'toolu_xyz',
    }));
  });

  it('emits both text and tool_use from a multi-block assistant message', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    emitStdout(proc, {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { path: '/foo.ts' } },
        ],
      },
    });

    expect(messages).toEqual([
      expect.objectContaining({ type: 'text', content: 'Let me read the file.' }),
      expect.objectContaining({
        type: 'tool_call',
        toolName: 'Read',
        toolInput: { path: '/foo.ts' },
        toolCallId: 'toolu_read',
      }),
    ]);
  });

  it('accumulates input_json_delta fragments into a complete tool_call', () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
    });

    const messages: any[] = [];
    handle.on('message', (message) => messages.push(message));

    // content_block_start with tool_use
    emitStdout(proc, {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_delta', name: 'Edit' },
    });

    // Streaming input_json_delta fragments
    emitStdout(proc, {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"file_' },
    });
    emitStdout(proc, {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: 'path": "/foo.ts"}' },
    });

    // No tool_call emitted yet during accumulation
    const toolCalls = messages.filter((m) => m.type === 'tool_call');
    expect(toolCalls).toHaveLength(0);

    // content_block_stop triggers the complete tool_call emission
    emitStdout(proc, {
      type: 'content_block_stop',
      index: 1,
    });

    const finalToolCalls = messages.filter((m) => m.type === 'tool_call');
    expect(finalToolCalls).toHaveLength(1);
    expect(finalToolCalls[0]).toMatchObject({
      type: 'tool_call',
      toolName: 'Edit',
      toolInput: { file_path: '/foo.ts' },
      toolCallId: 'toolu_delta',
    });
  });

  it('times out when startup never becomes healthy after spawn and hook noise', async () => {
    const proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);

    const handle = spawnClaude({
      taskId: 'task-1',
      prompt: 'hi',
      mode: 'act',
      cwd: '/workspace',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
    });

    const messages: any[] = [];
    const done = vi.fn();
    handle.on('message', (message) => messages.push(message));
    handle.on('done', done);

    vi.advanceTimersByTime(0);
    emitStdout(proc, {
      type: 'system',
      subtype: 'hook_started',
      hook_event: 'SessionStart',
      hook_name: 'SessionStart:startup',
    });

    // SSH doubles the effective timeout
    await vi.advanceTimersByTimeAsync(CLAUDE_STARTUP_TIMEOUT_MS * 2);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(messages.at(-1)).toMatchObject({
      type: 'error',
      content: expect.stringContaining('umera@extreme'),
    });
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(done).toHaveBeenCalledWith(expect.objectContaining({
      code: 1,
      error: expect.stringContaining('/remote/workspace'),
    }));
  });
});
