import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, randomUuidMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  randomUuidMock: vi.fn(),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock('crypto', () => ({
  default: {
    randomUUID: randomUuidMock,
  },
}));

import { ContextRequestDispatcher } from '../request-dispatcher';

class FakeReadable extends EventEmitter {}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeReadable();
  stderr = new FakeReadable();
  kill = vi.fn();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

describe('ContextRequestDispatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    randomUuidMock.mockReset();
    randomUuidMock.mockReturnValue('terminal-12345678');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('escalates spawned process cleanup to SIGKILL on dispose', async () => {
    const proc = new FakeChildProcess();
    spawnMock.mockReturnValue(proc as never);

    const dispatcher = new ContextRequestDispatcher({ cwd: '/tmp/workspace' });
    const result = await dispatcher.dispatch({
      id: '1',
      action: 'terminal:spawn',
      payload: { command: 'npm run dev' },
    });

    expect(result).toEqual({
      ok: true,
      data: { terminalId: 'terminal' },
    });

    dispatcher.dispose();
    expect(proc.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');

    vi.advanceTimersByTime(3_000);
    expect(proc.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('clears kill escalation timer when process exits after terminal:kill', async () => {
    const proc = new FakeChildProcess();
    spawnMock.mockReturnValue(proc as never);

    const dispatcher = new ContextRequestDispatcher({ cwd: '/tmp/workspace' });
    const spawnResult = await dispatcher.dispatch({
      id: '1',
      action: 'terminal:spawn',
      payload: { command: 'npm run dev' },
    });
    const terminalId = (spawnResult.data?.terminalId as string) ?? '';

    const killResult = await dispatcher.dispatch({
      id: '2',
      action: 'terminal:kill',
      payload: { terminalId },
    });
    expect(killResult).toEqual({ ok: true });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('close', 0);
    vi.advanceTimersByTime(3_000);

    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('times out terminal:exec with exit code 124 when process is terminated', async () => {
    const proc = new FakeChildProcess();
    spawnMock.mockReturnValue(proc as never);

    const dispatcher = new ContextRequestDispatcher({ cwd: '/tmp/workspace' });
    const pending = dispatcher.dispatch({
      id: '1',
      action: 'terminal:exec',
      payload: { command: 'sleep 60', timeout: 1_000 },
    });

    vi.advanceTimersByTime(1_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('close', null);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.data).toEqual(expect.objectContaining({ exitCode: 124 }));

    vi.advanceTimersByTime(3_000);
    expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
  });
});
