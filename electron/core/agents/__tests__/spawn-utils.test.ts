import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { agentCliEnv, resolveExecutable, resolveSshCommand, classifySpawnError } from '../../process-utils';
import { spawnAgentProcess, createStartupWatchdog, filterStderrNoise, isMeaningfulMessage } from '../spawn-utils';
import type { AgentMessage } from '../types';

describe('process-utils', () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it('resolves executables from an extended PATH without shelling out to which', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-bin-'));
    const fakeSsh = path.join(tempDir, 'ssh');
    fs.writeFileSync(fakeSsh, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakeSsh, 0o755);

    expect(resolveExecutable('ssh', { PATH: tempDir })).toBe(fakeSsh);
    expect(resolveSshCommand({ PATH: tempDir })).toBe(fakeSsh);
  });

  it('quotes remote agent commands so absolute binary paths survive SSH execution', () => {
    spawnMock.mockReturnValue({} as never);

    spawnAgentProcess({
      command: '/opt/Flux Tools/claude',
      args: ['--model', 'sonnet'],
      cwd: '/tmp/flux-local',
      sshHost: 'umera@extreme',
      remoteCwd: '/remote/workspace',
      env: { PATH: '/custom/bin' },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringContaining('ssh'),
      [
        'umera@extreme',
        "cd '/remote/workspace' && '/opt/Flux Tools/claude' '--model' 'sonnet'",
      ],
      expect.objectContaining({
        cwd: '/tmp/flux-local',
        env: expect.objectContaining({
          PATH: expect.stringContaining('/custom/bin'),
        }),
      }),
    );
  });

  it('strips debugger env from agent CLI spawns while preserving unrelated NODE_OPTIONS', () => {
    spawnMock.mockReturnValue({} as never);

    spawnAgentProcess({
      command: 'claude',
      args: ['--version'],
      cwd: '/tmp/flux-local',
      env: {
        PATH: '/custom/bin',
        NODE_OPTIONS: '--max-old-space-size=4096 --inspect=127.0.0.1:9229 --require \"/tmp/boot.js\" --inspect-publish-uid=http',
        VSCODE_INSPECTOR_OPTIONS: '{"inspectorIpc":"/tmp/node-cdp.sock"}',
        NODE_INSPECT_RESUME_ON_START: '1',
      },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['--version'],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining('/custom/bin'),
          NODE_OPTIONS: '--max-old-space-size=4096 --require "/tmp/boot.js"',
        }),
      }),
    );

    const spawnOptions = spawnMock.mock.calls[0]?.[2];
    expect(spawnOptions?.env?.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
    expect(spawnOptions?.env?.NODE_INSPECT_RESUME_ON_START).toBeUndefined();
  });

  it('removes inspector-only NODE_OPTIONS entirely for agent CLIs', () => {
    const env = agentCliEnv({
      NODE_OPTIONS: '--inspect-brk --inspect-port 9229',
      VSCODE_INSPECTOR_OPTIONS: '{"inspectorIpc":"/tmp/node-cdp.sock"}',
    });

    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
  });
});

describe('classifySpawnError', () => {
  it('classifies ENOENT with sshHost as SSH_NOT_FOUND', () => {
    const err = Object.assign(new Error('spawn /usr/bin/ssh ENOENT'), { code: 'ENOENT' });
    const info = classifySpawnError(err, { command: 'claude', sshHost: 'user@host' });
    expect(info.code).toBe('SSH_NOT_FOUND');
    expect(info.userMessage).toContain('SSH binary not found');
    expect(info.suggestion).toContain('OpenSSH');
  });

  it('classifies ENOENT without sshHost as COMMAND_NOT_FOUND', () => {
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const info = classifySpawnError(err, { command: 'claude' });
    expect(info.code).toBe('COMMAND_NOT_FOUND');
    expect(info.userMessage).toContain('"claude" not found');
    expect(info.suggestion).toContain('Install');
  });

  it('classifies EACCES as PERMISSION_DENIED', () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const info = classifySpawnError(err, { command: 'gemini' });
    expect(info.code).toBe('PERMISSION_DENIED');
    expect(info.suggestion).toContain('chmod');
  });

  it('classifies host key verification failure', () => {
    const err = new Error('Host key verification failed');
    const info = classifySpawnError(err, { command: 'ssh', sshHost: 'myhost' });
    expect(info.code).toBe('SSH_HOST_KEY');
    expect(info.suggestion).toContain('ssh-keyscan');
    expect(info.suggestion).toContain('myhost');
  });

  it('classifies connection timeout', () => {
    const err = new Error('Connection timed out');
    const info = classifySpawnError(err, { command: 'ssh', sshHost: 'myhost' });
    expect(info.code).toBe('SSH_TIMEOUT');
    expect(info.userMessage).toContain('myhost');
  });

  it('classifies connection refused', () => {
    const err = new Error('Connection refused');
    const info = classifySpawnError(err, { command: 'ssh', sshHost: 'myhost' });
    expect(info.code).toBe('SSH_REFUSED');
    expect(info.suggestion).toContain('SSH daemon');
  });

  it('classifies SSH publickey auth failure', () => {
    const err = new Error('Permission denied (publickey)');
    const info = classifySpawnError(err, { command: 'ssh', sshHost: 'myhost' });
    expect(info.code).toBe('SSH_AUTH');
    expect(info.suggestion).toContain('ssh-add');
  });

  it('falls back to UNKNOWN for unrecognized errors', () => {
    const err = new Error('Something went wrong');
    const info = classifySpawnError(err, { command: 'claude' });
    expect(info.code).toBe('UNKNOWN');
    expect(info.userMessage).toBe('Something went wrong');
    expect(info.suggestion).toBe('');
  });
});

describe('createStartupWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTimeout when no progress is reported', () => {
    const onTimeout = vi.fn();
    createStartupWatchdog({
      timeoutMs: 5000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    vi.advanceTimersByTime(5000);
    expect(onTimeout).toHaveBeenCalledWith(
      expect.stringContaining('TestAgent startup timed out after 5s'),
    );
  });

  it('includes SSH details in timeout error and doubles timeout for SSH', () => {
    const onTimeout = vi.fn();
    createStartupWatchdog({
      timeoutMs: 10000,
      label: 'Claude',
      sshHost: 'user@remote',
      remoteCwd: '/remote/dir',
      cwd: '/local',
      onTimeout,
    });

    // Should not fire at original timeout
    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();

    // Should fire at 2x timeout (20s)
    vi.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledWith(
      expect.stringContaining('over SSH'),
    );
    expect(onTimeout).toHaveBeenCalledWith(
      expect.stringContaining('user@remote'),
    );
    expect(onTimeout).toHaveBeenCalledWith(
      expect.stringContaining('20s'),
    );
  });

  it('does not fire when markProgress is called before timeout', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 5000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    vi.advanceTimersByTime(2000);
    watchdog.markProgress();
    vi.advanceTimersByTime(10000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resetProgress resets the resettable timer', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 10000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    // Advance 8s, then reset
    vi.advanceTimersByTime(8000);
    watchdog.resetProgress();

    // Advance another 8s — would be 16s total, past original 10s, but timer was reset
    vi.advanceTimersByTime(8000);
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance remaining 2s to hit the reset timer (10s from reset point)
    vi.advanceTimersByTime(2000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('hard timeout fires even when resetProgress keeps resetting', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 10000,
      maxTimeoutMs: 25000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    // Reset every 8s to keep the resettable timer alive
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(8000);
      watchdog.resetProgress();
    }

    // At 24s — still alive, hard timeout at 25s
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance past the hard timeout
    vi.advanceTimersByTime(2000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(
      expect.stringContaining('25s'),
    );
  });

  it('uses default hard timeout of 3x effective timeout', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 5000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    // Default hard timeout = 5000 * 3 = 15000
    // Keep resetting to avoid resettable timer
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(4000);
      watchdog.resetProgress();
    }

    // At 12s — not yet at hard timeout (15s)
    expect(onTimeout).not.toHaveBeenCalled();

    // Advance to 15s
    vi.advanceTimersByTime(3000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire when clear is called before timeout', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 5000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    watchdog.clear();
    vi.advanceTimersByTime(10000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('markProgress clears both resettable and hard timers', () => {
    const onTimeout = vi.fn();
    const watchdog = createStartupWatchdog({
      timeoutMs: 5000,
      maxTimeoutMs: 10000,
      label: 'TestAgent',
      cwd: '/workspace',
      onTimeout,
    });

    vi.advanceTimersByTime(2000);
    watchdog.markProgress();

    // Neither resettable nor hard timer should fire
    vi.advanceTimersByTime(20000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('filterStderrNoise', () => {
  it('filters Rust tracing timestamps', () => {
    expect(filterStderrNoise('2024-01-15T10:30:00Z some tracing output')).toBeNull();
  });

  it('filters noise-level log prefixes (DEBUG/TRACE/INFO)', () => {
    expect(filterStderrNoise('DEBUG something')).toBeNull();
    expect(filterStderrNoise('TRACE something')).toBeNull();
    expect(filterStderrNoise('INFO something')).toBeNull();
  });

  it('preserves ERROR and WARN log lines', () => {
    expect(filterStderrNoise('ERROR codex: Profile not found')).toBe('ERROR codex: Profile not found');
    expect(filterStderrNoise('WARN codex: API key missing')).toBe('WARN codex: API key missing');
  });

  it('filters rmcp namespace messages', () => {
    expect(filterStderrNoise('rmcp::transport something')).toBeNull();
  });

  it('filters MCP transport noise', () => {
    expect(filterStderrNoise('Transport channel closed')).toBeNull();
    expect(filterStderrNoise('transport error: connection reset')).toBeNull();
  });

  it('filters Node inspector noise', () => {
    const input = [
      'Debugger listening on ws://127.0.0.1:9229/abc123',
      'For help, see: https://nodejs.org/en/docs/inspector',
      'Debugger attached.',
      'Reading prompt from stdin...',
      'Waiting for the debugger to disconnect...',
    ].join('\n');
    expect(filterStderrNoise(input)).toBeNull();
  });

  it('preserves real error messages', () => {
    expect(filterStderrNoise('Error: file not found')).toBe('Error: file not found');
  });

  it('filters mixed content and returns only real lines', () => {
    const input = [
      '2024-01-15T10:30:00Z tracing',
      'Error: something real',
      'DEBUG noisy',
      'Another real error',
    ].join('\n');
    expect(filterStderrNoise(input)).toBe('Error: something real\nAnother real error');
  });

  it('returns null for empty input', () => {
    expect(filterStderrNoise('')).toBeNull();
    expect(filterStderrNoise('   ')).toBeNull();
  });
});

describe('isMeaningfulMessage', () => {
  const base: AgentMessage = {
    type: 'text',
    role: 'assistant',
    content: 'test',
    timestamp: Date.now(),
  };

  it('treats assistant text as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'text', role: 'assistant' })).toBe(true);
  });

  it('treats assistant thinking as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'thinking', role: 'assistant' })).toBe(true);
  });

  it('treats tool_call as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'tool_call' })).toBe(true);
  });

  it('treats tool_result as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'tool_result' })).toBe(true);
  });

  it('treats error as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'error' })).toBe(true);
  });

  it('treats progress status as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'status', statusKind: 'progress' })).toBe(true);
  });

  it('does not treat spawn status as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'status', statusKind: 'spawn' })).toBe(false);
  });

  it('does not treat system text as meaningful', () => {
    expect(isMeaningfulMessage({ ...base, type: 'text', role: 'system' })).toBe(false);
  });
});
