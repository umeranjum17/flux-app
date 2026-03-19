import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialTerminalCommandController,
  DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS,
} from '../initial-command';

describe('createInitialTerminalCommandController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes the initial command when the shell prompt is ready', () => {
    const write = vi.fn();
    const controller = createInitialTerminalCommandController({
      id: 'term-1',
      command: 'npm test',
      write,
    });

    controller.markPromptReady();

    expect(write).toHaveBeenCalledWith('npm test\n');
  });

  it('falls back to the timer when no prompt signal arrives', () => {
    const write = vi.fn();
    createInitialTerminalCommandController({
      id: 'term-2',
      command: 'npm run dev',
      write,
    });

    vi.advanceTimersByTime(DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS - 1);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledWith('npm run dev\n');
  });

  it('never writes the initial command more than once', () => {
    const write = vi.fn();
    const controller = createInitialTerminalCommandController({
      id: 'term-3',
      command: 'pnpm typecheck',
      write,
    });

    controller.markPromptReady();
    vi.advanceTimersByTime(DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS);
    controller.markPromptReady();

    expect(write).toHaveBeenCalledTimes(1);
  });

  it('clears the fallback timer on dispose', () => {
    const write = vi.fn();
    const controller = createInitialTerminalCommandController({
      id: 'term-4',
      command: 'npm test',
      write,
    });

    controller.dispose();
    vi.advanceTimersByTime(DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS);

    expect(write).not.toHaveBeenCalled();
  });

  it('logs write failures without throwing', () => {
    const error = new Error('write failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = createInitialTerminalCommandController({
      id: 'term-5',
      command: 'npm test',
      write: () => {
        throw error;
      },
    });

    expect(() => controller.markPromptReady()).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('[terminal term-5] Failed to write initial command', error);
  });
});
