import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import {
  extendedEnv,
  resolveSshCommand,
  classifySpawnError,
  attachChildStdinErrorHandler,
  safeWriteToChildStdin,
} from '../process-utils';
import { agentManager } from '../agents/manager';

const execFileAsync = promisify(execFile);

/**
 * Centralised owner of all SSH remote-connection state.
 *
 * Replaces the scattered `_sshHost` in `tools/ssh.ts`,
 * `sshHost` in `ipc-handlers/index.ts`, and the
 * `getSshHost/setSshHost` context closures.
 */
export class RemoteConnectionManager {
  private static _instance: RemoteConnectionManager | null = null;

  static get current(): RemoteConnectionManager | null {
    return RemoteConnectionManager._instance;
  }

  private _host: string | null = null;
  private _localCwd: string;

  constructor(initialLocalCwd: string) {
    this._localCwd = initialLocalCwd;
    RemoteConnectionManager._instance = this;
  }

  // ── Accessors ──────────────────────────────────────────────

  get host(): string | null {
    return this._host;
  }

  get localCwd(): string {
    return this._localCwd;
  }

  set localCwd(cwd: string) {
    this._localCwd = cwd;
  }

  isConnected(): boolean {
    return this._host !== null;
  }

  // ── Operations ─────────────────────────────────────────────

  async test(host: string): Promise<{ success: boolean; error: string | null }> {
    try {
      await execFileAsync(
        resolveSshCommand(),
        ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'],
        { timeout: 10000, env: extendedEnv() },
      );
      return { success: true, error: null };
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      return {
        success: false,
        error: `${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`,
      };
    }
  }

  /**
   * Connect to a remote host. Updates internal state on success.
   * @param currentCwd the current local CWD (saved so we can restore on disconnect)
   */
  async connect(
    host: string,
    currentCwd: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        resolveSshCommand(),
        ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'],
        { timeout: 10000, env: extendedEnv() },
      );
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      throw new Error(
        `SSH connection failed: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`,
      );
    }
    this._host = host;
    this._localCwd = currentCwd;
    await agentManager.detectAllRemote(host).catch(() => {});
  }

  /**
   * Disconnect from the remote host. Returns the local CWD to restore.
   */
  disconnect(): string {
    this._host = null;
    agentManager.detectAll().catch(() => {});
    return this._localCwd;
  }

  // ── SSH primitives (moved from tools/ssh.ts) ──────────────

  async exec(
    command: string,
    timeout: number = 30000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const host = this._host;
    if (!host) throw new Error('Not connected to SSH host');
    try {
      const { stdout, stderr } = await execFileAsync(
        resolveSshCommand(),
        [host, command],
        { timeout, env: extendedEnv() },
      );
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
        exitCode: err.code ?? 1,
      };
    }
  }

  async writeFile(
    remotePath: string,
    content: string,
    timeout: number = 30000,
  ): Promise<{ success: boolean; error?: string }> {
    const host = this._host;
    if (!host) throw new Error('Not connected to SSH host');
    const escaped = remotePath.replace(/'/g, "'\\''");
    const proc = spawn(resolveSshCommand(), [host, `cat > '${escaped}'`], {
      timeout,
      env: extendedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    } as any);
    attachChildStdinErrorHandler(proc, 'sshWriteFile');

    return new Promise((resolve) => {
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      safeWriteToChildStdin(proc, content, 'sshWriteFile');
      proc.stdin?.end();
      proc.on('close', (code: number) => {
        if (code === 0) resolve({ success: true });
        else resolve({ success: false, error: stderr || `Exit code ${code}` });
      });
      proc.on('error', (e: Error) => resolve({ success: false, error: e.message }));
    });
  }
}
