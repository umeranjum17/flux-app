import fs from 'fs';
import path from 'path';
import type { ChildProcess } from 'child_process';
import type { Writable } from 'stream';
import { log } from './log';

export type RuntimeEnvironment = 'local' | 'ssh' | 'wsl';

export interface EnvironmentInfo {
  /** The detected runtime environment */
  runtime: RuntimeEnvironment;
  /** The OS platform (darwin, linux, win32) */
  platform: NodeJS.Platform;
  /** WSL distro name if running inside WSL */
  wslDistro: string | null;
  /** True when the process was launched inside an SSH session */
  isSSHSession: boolean;
  /** True when running inside WSL */
  isWSL: boolean;
}

let cachedEnvInfo: EnvironmentInfo | null = null;

function detectWSL(): { isWSL: boolean; distro: string | null } {
  // WSL sets WSL_DISTRO_NAME in the environment
  if (process.env.WSL_DISTRO_NAME) {
    return { isWSL: true, distro: process.env.WSL_DISTRO_NAME };
  }
  // Also check WSL_INTEROP (WSL2) and WSLENV
  if (process.env.WSL_INTEROP || process.env.WSLENV) {
    return { isWSL: true, distro: process.env.WSL_DISTRO_NAME ?? null };
  }
  // Fallback: check /proc/version for "microsoft" or "WSL" (Linux only)
  if (process.platform === 'linux') {
    try {
      const version = fs.readFileSync('/proc/version', 'utf-8');
      if (/microsoft|wsl/i.test(version)) {
        return { isWSL: true, distro: process.env.WSL_DISTRO_NAME ?? null };
      }
    } catch {
      // Not available — not WSL
    }
  }
  return { isWSL: false, distro: null };
}

function detectSSHSession(): boolean {
  // Standard env vars set by OpenSSH when you connect into a host
  return !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

export function detectEnvironment(): EnvironmentInfo {
  if (cachedEnvInfo) return cachedEnvInfo;

  const wsl = detectWSL();
  const isSSHSession = detectSSHSession();

  let runtime: RuntimeEnvironment = 'local';
  if (wsl.isWSL) {
    runtime = 'wsl';
  } else if (isSSHSession) {
    runtime = 'ssh';
  }

  cachedEnvInfo = {
    runtime,
    platform: process.platform,
    wslDistro: wsl.distro,
    isSSHSession,
    isWSL: wsl.isWSL,
  };
  return cachedEnvInfo;
}

function listHomeBinDirectories(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) {
    return [];
  }

  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.nix-profile', 'bin'),
  ];
}

function listExtraBinDirectories(env: NodeJS.ProcessEnv): string[] {
  if (process.platform === 'win32') {
    const sysRoot = env.SystemRoot ?? 'C:\\Windows';
    return [
      path.join(sysRoot, 'System32'),
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      ...listHomeBinDirectories(env),
    ];
  }
  return [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    '/nix/var/nix/profiles/default/bin',
    '/run/current-system/sw/bin',
    ...listHomeBinDirectories(env),
  ];
}

function dedupe(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function listPathEntries(env: NodeJS.ProcessEnv): string[] {
  const currentPath = env.PATH ?? '';
  return dedupe([
    ...currentPath.split(path.delimiter),
    ...listExtraBinDirectories(env),
  ]);
}

function isPathCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\');
}

function isExecutable(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      return false;
    }
    // On Windows, X_OK is not meaningful; check file exists and has a known extension
    if (process.platform === 'win32') {
      return true;
    }
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function listCommandExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return [''];
  }

  const pathext = env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return pathext
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitNodeOptions(value: string): string[] {
  const tokens = value.match(/"([^"\\]|\\.)*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) => {
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    if (token.startsWith('\'') && token.endsWith('\'')) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function formatNodeOption(token: string): string {
  if (!/[\s"'\\]/.test(token)) {
    return token;
  }
  return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isInspectorNodeOption(token: string): boolean {
  return /^(--inspect(?:-brk|-port)?|--debug(?:-brk)?)(=.*)?$/.test(token)
    || /^--inspect-publish-uid(?:=.*)?$/.test(token);
}

function consumesNextNodeOption(token: string): boolean {
  return token === '--inspect-port' || token === '--debug-port' || token === '--inspect-publish-uid';
}

function isVsCodeBootloader(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('js-debug/src/bootloader.js')
    || (normalized.includes('ms-vscode.js-debug') && normalized.includes('bootloader.js'));
}

function sanitizeNodeOptions(nodeOptions: string | undefined): string | undefined {
  if (!nodeOptions?.trim()) {
    return undefined;
  }

  const tokens = splitNodeOptions(nodeOptions);
  const kept: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (isInspectorNodeOption(token)) {
      if (consumesNextNodeOption(token) && tokens[i + 1] && !tokens[i + 1].startsWith('-')) {
        i += 1;
      }
      continue;
    }

    if (token === '--require' || token === '-r' || token === '--import') {
      const next = tokens[i + 1];
      if (next && isVsCodeBootloader(next)) {
        i += 1;
        continue;
      }
      kept.push(token);
      if (next) {
        kept.push(next);
        i += 1;
      }
      continue;
    }

    if (token.startsWith('--require=')) {
      const requiredModule = token.slice('--require='.length);
      if (isVsCodeBootloader(requiredModule)) {
        continue;
      }
    }

    if (token.startsWith('--import=')) {
      const importedModule = token.slice('--import='.length);
      if (isVsCodeBootloader(importedModule)) {
        continue;
      }
    }

    kept.push(token);
  }

  if (kept.length === 0) {
    return undefined;
  }

  return kept.map(formatNodeOption).join(' ');
}

function sanitizeDebuggerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  const nodeOptions = sanitizeNodeOptions(sanitized.NODE_OPTIONS);

  if (nodeOptions) {
    sanitized.NODE_OPTIONS = nodeOptions;
  } else {
    delete sanitized.NODE_OPTIONS;
  }

  delete sanitized.VSCODE_INSPECTOR_OPTIONS;
  delete sanitized.ELECTRON_RUN_AS_NODE;
  delete sanitized.NODE_INSPECT_RESUME_ON_START;

  return sanitized;
}

export function extendedEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged = sanitizeDebuggerEnv({ ...process.env, ...env });
  const pathEntries = listPathEntries(merged);
  return {
    ...merged,
    PATH: pathEntries.join(path.delimiter),
  };
}

export function resolveExecutable(command: string, env?: NodeJS.ProcessEnv): string | null {
  const spawnEnv = extendedEnv(env);

  if (isPathCommand(command)) {
    return isExecutable(command) ? command : null;
  }

  const extensions = listCommandExtensions(spawnEnv);
  for (const dir of listPathEntries(spawnEnv)) {
    for (const extension of extensions) {
      const suffix = extension && !command.toLowerCase().endsWith(extension.toLowerCase())
        ? extension
        : '';
      const candidate = path.join(dir, `${command}${suffix}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function resolveSshCommand(env?: NodeJS.ProcessEnv): string {
  const command = process.platform === 'win32' ? 'ssh.exe' : 'ssh';
  return resolveExecutable(command, env) ?? command;
}

export interface SpawnErrorInfo {
  code: string;
  userMessage: string;
  suggestion: string;
}

export function classifySpawnError(
  err: Error,
  context: { command: string; host?: string; cwd?: string },
): SpawnErrorInfo {
  const msg = err.message ?? '';
  const code = (err as NodeJS.ErrnoException).code ?? '';

  if (code === 'ENOENT' || /ENOENT/.test(msg)) {
    // Check if the ENOENT is about the cwd rather than the command.
    // Node emits ENOENT for a missing cwd too, so disambiguate by checking
    // whether the cwd actually exists on disk.
    if (context.cwd) {
      try {
        fs.accessSync(context.cwd);
      } catch {
        return {
          code: 'CWD_NOT_FOUND',
          userMessage: `Working directory not found: ${context.cwd}`,
          suggestion: 'The workspace directory may have been removed. Try creating a new workspace',
        };
      }
    }

    if (context.host) {
      return {
        code: 'SSH_NOT_FOUND',
        userMessage: 'SSH binary not found',
        suggestion: process.platform === 'win32'
          ? 'Install OpenSSH (Settings > Apps > Optional Features > OpenSSH Client)'
          : 'Install OpenSSH or verify PATH includes /usr/bin',
      };
    }
    return {
      code: 'COMMAND_NOT_FOUND',
      userMessage: `"${context.command}" not found`,
      suggestion: `Install ${context.command} or check your PATH`,
    };
  }

  if (code === 'EACCES' || /EACCES/.test(msg)) {
    return {
      code: 'PERMISSION_DENIED',
      userMessage: `Permission denied running "${context.command}"`,
      suggestion: process.platform === 'win32'
        ? 'Try running as Administrator or check file permissions'
        : 'Check file permissions (chmod +x)',
    };
  }

  if (/Host key verification failed/i.test(msg)) {
    const host = context.host ?? 'HOST';
    return {
      code: 'SSH_HOST_KEY',
      userMessage: 'SSH host key verification failed',
      suggestion: process.platform === 'win32'
        ? `Run: ssh-keyscan ${host} >> %USERPROFILE%\\.ssh\\known_hosts`
        : `Run: ssh-keyscan ${host} >> ~/.ssh/known_hosts`,
    };
  }

  if (/Connection timed out/i.test(msg)) {
    return {
      code: 'SSH_TIMEOUT',
      userMessage: `SSH connection timed out${context.host ? ` to ${context.host}` : ''}`,
      suggestion: 'Verify the host is reachable (ping or ssh -v)',
    };
  }

  if (/Connection refused/i.test(msg)) {
    return {
      code: 'SSH_REFUSED',
      userMessage: `SSH connection refused${context.host ? ` by ${context.host}` : ''}`,
      suggestion: 'Verify the SSH daemon is running on the remote host',
    };
  }

  if (/Permission denied.*publickey/i.test(msg)) {
    return {
      code: 'SSH_AUTH',
      userMessage: 'SSH authentication failed (publickey)',
      suggestion: 'Check your SSH key is loaded: ssh-add -l',
    };
  }

  return {
    code: 'UNKNOWN',
    userMessage: msg || 'Unknown error',
    suggestion: '',
  };
}

const STREAM_ERROR_HANDLER_ATTACHED = Symbol('streamErrorHandlerAttached');

type MarkedWritable = Writable & {
  [STREAM_ERROR_HANDLER_ATTACHED]?: boolean;
  writableEnded?: boolean;
};

export function isIgnorableStreamWriteError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}

function isWritableOpen(stream: Writable | null | undefined): stream is MarkedWritable {
  if (!stream) return false;
  const candidate = stream as MarkedWritable;
  return candidate.writable && !candidate.destroyed && candidate.writableEnded !== true;
}

export function attachStreamErrorHandler(stream: Writable | null | undefined, context: string): void {
  if (!stream) return;
  const candidate = stream as MarkedWritable;
  if (candidate[STREAM_ERROR_HANDLER_ATTACHED]) return;
  candidate[STREAM_ERROR_HANDLER_ATTACHED] = true;
  candidate.on('error', (err: Error) => {
    if (isIgnorableStreamWriteError(err)) return;
    log.warn(context, 'stream error', err);
  });
}

export function safeWriteToStream(
  stream: Writable | null | undefined,
  data: string | Uint8Array,
  context: string,
): boolean {
  if (!isWritableOpen(stream)) return false;
  const writable = stream as MarkedWritable;
  try {
    writable.write(data, (err?: Error | null) => {
      if (!err || isIgnorableStreamWriteError(err)) return;
      log.warn(context, 'stream write failed', err);
    });
    return true;
  } catch (err) {
    if (!isIgnorableStreamWriteError(err)) {
      log.warn(context, 'stream write threw', err);
    }
    return false;
  }
}

export function attachChildStdinErrorHandler(proc: ChildProcess, context: string): void {
  attachStreamErrorHandler(proc.stdin, `${context}:stdin`);
}

export function safeWriteToChildStdin(
  proc: ChildProcess,
  data: string | Uint8Array,
  context: string,
): boolean {
  return safeWriteToStream(proc.stdin, data, `${context}:stdin`);
}
