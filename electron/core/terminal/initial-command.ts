import { log } from '../log';

export const DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS = 1_000;

export interface InitialTerminalCommandController {
  markPromptReady: () => void;
  dispose: () => void;
}

interface InitialTerminalCommandOptions {
  id: string;
  command?: string;
  fallbackDelayMs?: number;
  write: (data: string) => void;
}

export function createInitialTerminalCommandController({
  id,
  command,
  fallbackDelayMs = DEFAULT_INITIAL_COMMAND_FALLBACK_DELAY_MS,
  write,
}: InitialTerminalCommandOptions): InitialTerminalCommandController {
  if (!command) {
    return {
      markPromptReady() {},
      dispose() {},
    };
  }

  let sent = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    flush();
  }, fallbackDelayMs);

  const flush = () => {
    if (sent) return;
    sent = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    try {
      write(`${command}\n`);
    } catch (error) {
      log.error(`terminal ${id}`, 'Failed to write initial command', error);
    }
  };

  return {
    markPromptReady() {
      flush();
    },
    dispose() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    },
  };
}
