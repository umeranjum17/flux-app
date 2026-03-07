import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let _sshHost: string | null = null;

export function getSshHost(): string | null {
  return _sshHost;
}

export function setSshHost(host: string | null): void {
  _sshHost = host;
}

export async function sshExec(
  host: string,
  command: string,
  timeout: number = 30000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('ssh', [host, command], { timeout });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode: err.code ?? 1,
    };
  }
}

export async function sshWriteFile(
  host: string,
  remotePath: string,
  content: string,
  timeout: number = 30000,
): Promise<{ success: boolean; error?: string }> {
  const escaped = remotePath.replace(/'/g, "'\\''");
  const proc = spawn('ssh', [host, `cat > '${escaped}'`], {
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  } as any);

  return new Promise((resolve) => {
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.stdin?.write(content);
    proc.stdin?.end();
    proc.on('close', (code: number) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: stderr || `Exit code ${code}` });
    });
    proc.on('error', (e: Error) => resolve({ success: false, error: e.message }));
  });
}
