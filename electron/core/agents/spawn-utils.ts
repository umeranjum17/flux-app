import { spawn, type ChildProcess } from 'child_process';

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

  if (!sshHost) {
    return spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ?? { ...process.env },
    });
  }

  // SSH mode: build a shell command and run it via ssh (no -tt to avoid corrupting NDJSON)
  const escapedArgs = args.map(escapeShellArg).join(' ');
  const cdPart = remoteCwd ? `cd ${toRemoteShellPath(remoteCwd)} && ` : '';
  const shellCommand = `${cdPart}${command} ${escapedArgs}`;

  return spawn('ssh', [sshHost, shellCommand], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env ?? { ...process.env },
  });
}
