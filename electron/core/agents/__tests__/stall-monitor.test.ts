import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StallMonitor } from '../stall-monitor';

describe('StallMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires idle_timeout when no activity occurs', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-1',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    // Advance past the 45s idle timeout
    vi.advanceTimersByTime(45_000);

    expect(onStallDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'idle_timeout',
        durationMs: 45_000,
        autoRestartsRemaining: 2,
      }),
    );

    monitor.dispose();
  });

  it('resets idle timer on markActivity', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-2',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    // Advance 30s, then mark activity
    vi.advanceTimersByTime(30_000);
    expect(onStallDetected).not.toHaveBeenCalled();

    monitor.markActivity();

    // Advance another 30s — should NOT fire (timer was reset)
    vi.advanceTimersByTime(30_000);
    expect(onStallDetected).not.toHaveBeenCalled();

    // Advance to 45s after last activity — should fire
    vi.advanceTimersByTime(15_000);
    expect(onStallDetected).toHaveBeenCalledTimes(1);

    monitor.dispose();
  });

  it('fires tool_timeout for Read tool at 30s', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-3',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    monitor.trackToolCall('tc-1', 'Read');

    // At 29s — should not fire
    vi.advanceTimersByTime(29_000);
    expect(onStallDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_timeout' }),
    );

    // At 30s — should fire
    vi.advanceTimersByTime(1_000);
    expect(onStallDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_timeout',
        toolName: 'Read',
        toolCallId: 'tc-1',
      }),
    );

    monitor.dispose();
  });

  it('clears tool timer on trackToolResult', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-4',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    monitor.trackToolCall('tc-1', 'Grep');

    // Complete the tool after 10s
    vi.advanceTimersByTime(10_000);
    monitor.trackToolResult('tc-1');

    // Advance past the 45s Grep timeout — should NOT fire tool_timeout
    vi.advanceTimersByTime(40_000);
    const toolTimeoutCalls = onStallDetected.mock.calls.filter(
      (args) => args[0].type === 'tool_timeout',
    );
    expect(toolTimeoutCalls).toHaveLength(0);

    monitor.dispose();
  });

  it('uses 3 min timeout for Bash tool', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-5',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    monitor.trackToolCall('tc-1', 'Bash');

    // At 2 min — should not fire
    vi.advanceTimersByTime(120_000);
    const calls = onStallDetected.mock.calls.filter(
      (args) => args[0].type === 'tool_timeout',
    );
    expect(calls).toHaveLength(0);

    // At 3 min — should fire
    vi.advanceTimersByTime(60_000);
    expect(onStallDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_timeout',
        toolName: 'Bash',
      }),
    );

    monitor.dispose();
  });

  it('decrements autoRestartsRemaining after recordRestart', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-6',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    monitor.recordRestart();
    monitor.trackToolCall('tc-1', 'Read');
    vi.advanceTimersByTime(30_000);

    expect(onStallDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRestartsRemaining: 1,
      }),
    );

    monitor.dispose();
  });

  it('fires onProcessDead when isAlive returns false', () => {
    const onProcessDead = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-7',
      maxAutoRestarts: 2,
      onStallDetected: vi.fn(),
      onProcessDead,
    });

    let alive = true;
    monitor.startHealthCheck(() => alive);

    // Process still alive after one check
    vi.advanceTimersByTime(10_000);
    expect(onProcessDead).not.toHaveBeenCalled();

    // Process dies
    alive = false;
    vi.advanceTimersByTime(10_000);
    expect(onProcessDead).toHaveBeenCalledTimes(1);

    monitor.dispose();
  });

  it('does not fire after dispose', () => {
    const onStallDetected = vi.fn();
    const monitor = new StallMonitor({
      taskId: 'test-8',
      maxAutoRestarts: 2,
      onStallDetected,
      onProcessDead: vi.fn(),
    });

    monitor.trackToolCall('tc-1', 'Read');
    monitor.dispose();

    vi.advanceTimersByTime(60_000);
    expect(onStallDetected).not.toHaveBeenCalled();
  });
});
