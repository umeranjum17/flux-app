import { spawn, type ChildProcess } from 'child_process';
import { extendedEnv, resolveExecutable, resolveSshCommand } from '../process-utils';
import { AgentMessage } from './types';

export interface SpawnAgentProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  sshHost?: string;
  remoteCwd?: string;
}

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toRemoteShellPath(value: string): string {
  const trimmed = value.trim() || '~';
  if (trimmed === '~') return '"$HOME"';
  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2);
    return rest ? `"$HOME"/${escapeShellArg(rest)}` : '"$HOME"';
  }
  return escapeShellArg(trimmed);
}

export function spawnAgentProcess(options: SpawnAgentProcessOptions): ChildProcess {
  const { command, args, cwd, env, sshHost, remoteCwd } = options;
  const spawnEnv = extendedEnv(env);
  const resolvedCommand = resolveExecutable(command, spawnEnv) ?? command;

  if (!sshHost) {
    return spawn(resolvedCommand, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
    });
  }

  // SSH mode: build a shell command and run it via ssh (no -tt to avoid corrupting NDJSON)
  const escapedCommand = escapeShellArg(command);
  const escapedArgs = args.map(escapeShellArg).join(' ');
  const cdPart = remoteCwd ? `cd ${toRemoteShellPath(remoteCwd)} && ` : '';
  const commandPart = escapedArgs ? `${escapedCommand} ${escapedArgs}` : escapedCommand;
  const shellCommand = `${cdPart}${commandPart}`;

  return spawn(resolveSshCommand(spawnEnv), [sshHost, shellCommand], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv,
  });
}

export function terminateAgentProcess(
  proc: ChildProcess,
  options?: { forceKillAfterMs?: number; closeStdin?: boolean },
): Promise<void> {
  const forceKillAfterMs = options?.forceKillAfterMs ?? 5000;
  const closeStdin = options?.closeStdin ?? true;

  return new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      proc.removeListener('close', finish);
      proc.removeListener('exit', finish);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve();
    };

    proc.once('close', finish);
    proc.once('exit', finish);

    if (proc.exitCode != null || proc.signalCode != null) {
      finish();
      return;
    }

    if (closeStdin && proc.stdin?.writable) {
      try { proc.stdin.end(); } catch {}
    }

    try { proc.kill('SIGTERM'); } catch {}

    forceKillTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      // Resolve even if the OS never delivers a close event so callers can
      // continue cleanup and avoid wedging task state forever.
      finish();
    }, forceKillAfterMs);
  });
}

export interface StartupWatchdog {
  markProgress: () => void;
  resetProgress: () => void;
  clear: () => void;
}

export function createStartupWatchdog(opts: {
  timeoutMs: number;
  maxTimeoutMs?: number;
  label: string;
  sshHost?: string;
  remoteCwd?: string;
  cwd: string;
  onTimeout: (error: string) => void;
}): StartupWatchdog {
  let fired = false;
  let cleared = false;

  const effectiveTimeout = opts.sshHost ? opts.timeoutMs * 2 : opts.timeoutMs;
  const hardTimeout = opts.maxTimeoutMs ?? effectiveTimeout * 3;

  const fireTimeout = (isHard: boolean) => {
    if (fired || cleared) return;
    fired = true;
    clearTimeout(resettableTimer);
    clearTimeout(hardTimer);

    const timeoutSec = Math.round((isHard ? hardTimeout : effectiveTimeout) / 1000);
    const target = opts.sshHost
      ? `${opts.sshHost} (cwd: ${opts.remoteCwd ?? opts.cwd})`
      : `cwd: ${opts.cwd}`;
    const error = opts.sshHost
      ? `${opts.label} startup timed out over SSH after ${timeoutSec}s on ${target}`
      : `${opts.label} startup timed out after ${timeoutSec}s (${target})`;

    opts.onTimeout(error);
  };

  let resettableTimer = setTimeout(() => fireTimeout(false), effectiveTimeout);
  const hardTimer = setTimeout(() => fireTimeout(true), hardTimeout);

  return {
    markProgress() {
      if (fired || cleared) return;
      cleared = true;
      clearTimeout(resettableTimer);
      clearTimeout(hardTimer);
    },
    resetProgress() {
      if (fired || cleared) return;
      clearTimeout(resettableTimer);
      resettableTimer = setTimeout(() => fireTimeout(false), effectiveTimeout);
    },
    clear() {
      if (cleared) return;
      cleared = true;
      clearTimeout(resettableTimer);
      clearTimeout(hardTimer);
    },
  };
}

export function filterStderrNoise(text: string): string | null {
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // Node/VS Code inspector auto-attach noise
    if (/^Debugger listening on ws:\/\//.test(trimmed)) return false;
    if (/^For help, see: https:\/\/nodejs\.org\/.*inspector/.test(trimmed)) return false;
    if (/^Debugger attached\.?$/i.test(trimmed)) return false;
    if (/^Reading prompt from stdin/i.test(trimmed)) return false;
    if (/^Waiting for the debugger to disconnect/i.test(trimmed)) return false;
    // Rust tracing / logging output
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return false;
    if (/^\s*(DEBUG|TRACE|INFO)\s/.test(trimmed)) return false;
    if (/^\s*(ERROR|WARN)\s/.test(trimmed)) return true;
    if (/rmcp::/.test(trimmed)) return false;
    // MCP transport noise
    if (/Transport channel closed/i.test(trimmed)) return false;
    if (/transport error/i.test(trimmed)) return false;
    return true;
  });
  return lines.length > 0 ? lines.join('\n') : null;
}

export type ErrorKind = 'auth' | 'rate_limit' | 'network' | 'context';

const AUTH_PATTERNS = [
  'authentication_error',
  'oauth token has expired',
  'unauthorized',
  'invalid api key',
  'invalid_api_key',
  'failed to authenticate',
  'authentication failed',
];

/**
 * Detect well-known error categories from raw error text and return
 * a user-friendly message + errorKind, or null if unrecognized.
 */
export function classifyErrorContent(content: string): { errorKind: ErrorKind; message: string } | null {
  const lower = content.toLowerCase();

  if (AUTH_PATTERNS.some(p => lower.includes(p))) {
    return {
      errorKind: 'auth',
      message: 'Authentication failed. Please re-authenticate to continue.',
    };
  }
  if (lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('overloaded')) {
    return {
      errorKind: 'rate_limit',
      message: 'Rate limited by API. Wait a few minutes or switch to a different model.',
    };
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) {
    return {
      errorKind: 'network',
      message: 'Network connectivity issue. Check your internet connection.',
    };
  }
  if (lower.includes('context window') || lower.includes('context length') || lower.includes('too many tokens')) {
    return {
      errorKind: 'context',
      message: 'Context window exceeded. Start a new session or use a model with larger context.',
    };
  }
  return null;
}

export function isMeaningfulMessage(message: AgentMessage): boolean {
  if (
    message.type === 'error' ||
    message.type === 'permission_request' ||
    message.type === 'question_request' ||
    message.type === 'result' ||
    message.type === 'tool_call' ||
    message.type === 'tool_result'
  ) {
    return true;
  }
  if ((message.type === 'text' || message.type === 'thinking') && message.role === 'assistant') {
    return true;
  }
  if (message.type === 'status' && message.statusKind === 'progress') {
    return true;
  }
  return false;
}
