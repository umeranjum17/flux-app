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
 * Supports multiple concurrent SSH connections keyed by host.
 * The "active" host is the most recently connected one (for backward compat).
 */
export class RemoteConnectionManager {
  private static _instance: RemoteConnectionManager | null = null;

  static get current(): RemoteConnectionManager | null {
    return RemoteConnectionManager._instance;
  }

  /** Active connections keyed by host */
  private _connections = new Map<string, { connectedAt: number }>();
  /** The most recently activated host (backward compat) */
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

  /** Check if a specific host has an active connection */
  isHostConnected(host: string): boolean {
    return this._connections.has(host);
  }

  /** Get all currently connected hosts */
  get connectedHosts(): string[] {
    return Array.from(this._connections.keys());
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
   * Connect to a remote host. Reuses existing connection if already connected.
   * @param currentCwd the current local CWD (saved so we can restore on disconnect)
   */
  async connect(
    host: string,
    currentCwd: string,
  ): Promise<void> {
    // Reuse existing connection
    if (this._connections.has(host)) {
      console.log(`[ssh] Reusing existing connection to ${host}`);
      this._host = host;
      this._localCwd = currentCwd;
      return;
    }
    console.log(`[ssh] Connecting to ${host}…`);

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
    this._connections.set(host, { connectedAt: Date.now() });
    this._host = host;
    this._localCwd = currentCwd;
    console.log(`[ssh] Connected to ${host}. Running remote agent detection…`);
    await agentManager.detectAllRemote(host).catch((err) => {
      console.warn(`[ssh] Remote agent detection failed for ${host}:`, err);
    });
  }

  /**
   * Disconnect from a specific host. If it was the active host, clears active.
   */
  disconnectHost(host: string): void {
    console.log(`[ssh] Disconnecting host: ${host}`);
    this._connections.delete(host);
    if (this._host === host) {
      const remaining = Array.from(this._connections.keys());
      this._host = remaining.length > 0 ? remaining[0] : null;
      console.log(`[ssh] Active host changed to: ${this._host ?? 'none'}`);
    }
    // Clear cached remote state for this host
    agentManager.clearRemoteAgents(host);
    // clearRemoteHomeCache is imported lazily to avoid circular deps
    import('../worktree/remote-manager').then(({ clearRemoteHomeCache }) => {
      clearRemoteHomeCache(host);
    }).catch(() => {});
    if (this._connections.size === 0) {
      agentManager.detectAll().catch(() => {});
    }
  }

  /**
   * Disconnect from the active remote host. Returns the local CWD to restore.
   */
  disconnect(): string {
    const previousHost = this._host;
    console.log(`[ssh] Disconnecting active host: ${previousHost ?? 'none'}`);
    if (this._host) {
      this._connections.delete(this._host);
      agentManager.clearRemoteAgents(this._host);
    }
    this._host = null;
    if (this._connections.size === 0) {
      agentManager.detectAll().catch(() => {});
    }
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
