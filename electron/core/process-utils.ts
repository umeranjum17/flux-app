import fs from 'fs';
import path from 'path';

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

export function extendedEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged = { ...process.env, ...env };
  const pathEntries = listPathEntries(merged);
  return {
    ...merged,
    PATH: pathEntries.join(path.delimiter),
  };
}

function splitShellStyleArgs(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function unquoteShellToken(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith('\'') && token.endsWith('\''))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function isNodeInspectorFlag(token: string): boolean {
  const normalized = unquoteShellToken(token);
  return (
    normalized === '--inspect' ||
    normalized === '--inspect-brk' ||
    normalized === '--inspect-port' ||
    normalized === '--inspect-publish-uid' ||
    normalized === '--debug-port' ||
    normalized.startsWith('--inspect=') ||
    normalized.startsWith('--inspect-brk=') ||
    normalized.startsWith('--inspect-port=') ||
    normalized.startsWith('--inspect-publish-uid=') ||
    normalized.startsWith('--debug-port=')
  );
}

function stripsNextToken(token: string): boolean {
  const normalized = unquoteShellToken(token);
  return (
    normalized === '--inspect-port' ||
    normalized === '--inspect-publish-uid' ||
    normalized === '--debug-port'
  );
}

export function agentCliEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...extendedEnv(env) };
  const nodeOptions = sanitized.NODE_OPTIONS;

  if (typeof nodeOptions === 'string' && nodeOptions.trim()) {
    const keptTokens: string[] = [];
    let skipNextToken = false;

    for (const token of splitShellStyleArgs(nodeOptions)) {
      if (skipNextToken) {
        skipNextToken = false;
        continue;
      }
      if (isNodeInspectorFlag(token)) {
        skipNextToken = stripsNextToken(token);
        continue;
      }
      keptTokens.push(token);
    }

    if (keptTokens.length > 0) {
      sanitized.NODE_OPTIONS = keptTokens.join(' ');
    } else {
      delete sanitized.NODE_OPTIONS;
    }
  }

  delete sanitized.VSCODE_INSPECTOR_OPTIONS;
  delete sanitized.NODE_INSPECT_RESUME_ON_START;

  return sanitized;
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
  context: { command: string; sshHost?: string },
): SpawnErrorInfo {
  const msg = err.message ?? '';
  const code = (err as NodeJS.ErrnoException).code ?? '';

  if (code === 'ENOENT' || /ENOENT/.test(msg)) {
    if (context.sshHost) {
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
    const host = context.sshHost ?? 'HOST';
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
      userMessage: `SSH connection timed out${context.sshHost ? ` to ${context.sshHost}` : ''}`,
      suggestion: 'Verify the host is reachable (ping or ssh -v)',
    };
  }

  if (/Connection refused/i.test(msg)) {
    return {
      code: 'SSH_REFUSED',
      userMessage: `SSH connection refused${context.sshHost ? ` by ${context.sshHost}` : ''}`,
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
