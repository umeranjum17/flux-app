import { exec } from 'child_process';
import { RemoteConnectionManager } from '../remote/connection-manager';

const BANNED_COMMANDS = ['rm -rf /', 'mkfs', 'dd if='];

export async function executeBash(
  command: string,
  cwd: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  for (const banned of BANNED_COMMANDS) {
    if (command.includes(banned)) {
      return {
        stdout: '',
        stderr: `Command rejected: contains banned pattern "${banned}"`,
        exitCode: 1,
      };
    }
  }

  const remote = RemoteConnectionManager.current;
  if (remote?.host) {
    const escaped = cwd.replace(/'/g, "'\\''");
    return remote.exec(`cd '${escaped}' && ${command}`, timeout);
  }

  return new Promise((resolve) => {
    exec(command, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}
