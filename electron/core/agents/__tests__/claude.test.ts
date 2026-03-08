import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_STARTUP_TIMEOUT_MS, spawnClaude } from '../claude';
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

  it('times out when startup never becomes healthy after spawn and hook noise', () => {
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

    vi.advanceTimersByTime(CLAUDE_STARTUP_TIMEOUT_MS);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(messages.at(-1)).toMatchObject({
      type: 'error',
      content: expect.stringContaining('umera@extreme'),
    });
    expect(done).toHaveBeenCalledWith(expect.objectContaining({
      code: 1,
      error: expect.stringContaining('/remote/workspace'),
    }));
  });
});
