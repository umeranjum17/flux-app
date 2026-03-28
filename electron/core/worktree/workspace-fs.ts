/**
 * WorkspaceFs — Strategy pattern for workspace filesystem operations.
 *
 * Eliminates scattered `if (host)` conditionals by providing a single
 * interface that works identically for local and remote workspaces.
 *
 * Usage:
 *   const wfs = createWorkspaceFs(workspace.host);
 *   await wfs.git(workspace.worktreePath, ['status']);
 *   await wfs.readFile(`${workspace.worktreePath}/package.json`);
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { extendedEnv } from '../process-utils';
import { escapeShell } from '../shell-escape';

const execFileAsync = promisify(execFile);

function resolveLoginShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL;
  return '/bin/sh';
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface WorkspaceFs {
  /** Execute a git command in the given directory. */
  git(cwd: string, args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>;

  /** Read a file. Returns null if it doesn't exist. */
  readFile(filePath: string): Promise<string | null>;

  /** Write content to a file, creating parent directories as needed. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Write binary content to a file, creating parent directories as needed. */
  writeBuffer(filePath: string, content: Uint8Array): Promise<void>;

  /** Check if a path exists. */
  exists(filePath: string): Promise<boolean>;

  /** List directory entries. Returns an empty list when the directory is missing. */
  listDir(dirPath: string): Promise<string[]>;

  /** Create directories recursively. */
  mkdirp(dirPath: string): Promise<void>;

  /** Remove a path recursively if it exists. */
  rmrf(targetPath: string): Promise<void>;

  /** Execute an arbitrary shell command in the given directory. */
  exec(cwd: string, command: string, opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /** Get disk usage in bytes. Returns 0 on error. */
  diskUsage(dirPath: string): Promise<number>;

  /** Whether this is a remote (SSH) filesystem. */
  readonly isRemote: boolean;

  /** SSH host string, or undefined for local. */
  readonly host: string | undefined;
}

// ---------------------------------------------------------------------------
// Local implementation
// ---------------------------------------------------------------------------

class LocalWorkspaceFs implements WorkspaceFs {
  readonly isRemote = false;
  readonly host = undefined;

  async git(cwd: string, args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: opts?.timeout ?? 30000,
      env: extendedEnv(),
    });
    return { stdout, stderr };
  }

  async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  async writeBuffer(filePath: string, content: Uint8Array): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listDir(dirPath: string): Promise<string[]> {
    try {
      return await fs.promises.readdir(dirPath);
    } catch {
      return [];
    }
  }

  async mkdirp(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async rmrf(targetPath: string): Promise<void> {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  }

  async exec(cwd: string, command: string, opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const shell = resolveLoginShell();
    const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-lc', command];
    try {
      const { stdout, stderr } = await execFileAsync(shell, args, {
        cwd,
        timeout: opts?.timeout ?? 30000,
        env: extendedEnv(),
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
        exitCode: err.code ?? 1,
      };
    }
  }

  async diskUsage(dirPath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('du', ['-sk', dirPath], { timeout: 10000 });
      return (parseInt(stdout.split('\t')[0], 10) || 0) * 1024;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Remote (SSH) implementation
// ---------------------------------------------------------------------------

class RemoteWorkspaceFs implements WorkspaceFs {
  readonly isRemote = true;
  readonly host: string;

  private _remote?: Promise<typeof import('./remote-manager')>;

  constructor(host: string) {
    this.host = host;
  }

  private get remote() {
    // Lazy import to avoid circular dependency at module load time; cached after first call
    return (this._remote ??= import('./remote-manager'));
  }

  async git(cwd: string, args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }> {
    const { remoteExecGit } = await this.remote;
    return remoteExecGit(this.host, cwd, args, opts?.timeout);
  }

  async readFile(filePath: string): Promise<string | null> {
    const { remoteReadFile } = await this.remote;
    return remoteReadFile(this.host, filePath);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const { remoteWriteFile } = await this.remote;
    return remoteWriteFile(this.host, filePath, content);
  }

  async writeBuffer(filePath: string, content: Uint8Array): Promise<void> {
    const { remoteWriteBuffer } = await this.remote;
    return remoteWriteBuffer(this.host, filePath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    const { remotePathExists } = await this.remote;
    return remotePathExists(this.host, filePath);
  }

  async listDir(dirPath: string): Promise<string[]> {
    const { remoteListDir } = await this.remote;
    return remoteListDir(this.host, dirPath);
  }

  async mkdirp(dirPath: string): Promise<void> {
    const { remoteExec } = await this.remote;
    await remoteExec(this.host, '/', `mkdir -p '${escapeShell(dirPath)}'`);
  }

  async rmrf(targetPath: string): Promise<void> {
    const { remoteExec } = await this.remote;
    await remoteExec(this.host, '/', `rm -rf '${escapeShell(targetPath)}'`);
  }

  async exec(cwd: string, command: string, opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { remoteExec } = await this.remote;
    return remoteExec(this.host, cwd, command, opts?.timeout);
  }

  async diskUsage(dirPath: string): Promise<number> {
    try {
      const result = await this.exec('/', `du -sk '${escapeShell(dirPath)}'`);
      if (result.exitCode === 0) {
        return (parseInt(result.stdout.split('\t')[0], 10) || 0) * 1024;
      }
      return 0;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const localInstance = new LocalWorkspaceFs();

/** Create a WorkspaceFs for the given SSH host (remote) or local (undefined). */
export function createWorkspaceFs(host?: string): WorkspaceFs {
  if (host) return new RemoteWorkspaceFs(host);
  return localInstance;
}

// ---------------------------------------------------------------------------
// Worktree lifecycle helpers
// ---------------------------------------------------------------------------

export interface WorktreeCreateResult {
  worktree: import('./types').WorktreeInfo;
  baseBranch: string | undefined;
}

/**
 * Create a worktree (local or remote) and resolve the base branch.
 * Encapsulates the local/remote branching so callers don't need to.
 */
export async function createWorktreeAny(
  host: string | undefined,
  parentRepo: string,
  branch: string,
  name: string,
): Promise<WorktreeCreateResult> {
  const wfs = createWorkspaceFs(host);
  let worktree: import('./types').WorktreeInfo;

  if (host) {
    const { createRemoteWorktree } = await import('./remote-manager');
    worktree = await createRemoteWorktree(host, parentRepo, branch, name);
  } else {
    // Auto-initialize git if needed
    try {
      await wfs.git(parentRepo, ['rev-parse', '--git-dir'], { timeout: 5000 });
    } catch {
      if (!(await wfs.exists(parentRepo))) {
        throw new Error(`Directory "${parentRepo}" does not exist.`);
      }
      await wfs.git(parentRepo, ['init'], { timeout: 10000 });
      await wfs.git(parentRepo, ['-c', 'user.name=Flux', '-c', 'user.email=flux@local', 'commit', '--allow-empty', '-m', 'Initial commit'], { timeout: 10000 });
    }
    const { createWorktree } = await import('./manager');
    worktree = await createWorktree(parentRepo, branch, name);
  }

  // Capture the currently checked-out branch so merges default back to it
  let baseBranch: string | undefined;
  try {
    const { stdout } = await wfs.git(parentRepo, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
    baseBranch = stdout.trim() || undefined;
  } catch { /* best-effort */ }

  return { worktree, baseBranch };
}

export interface RemoveWorktreeOptions {
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
}

/**
 * Remove a worktree (local or remote).
 * Encapsulates the local/remote branching so callers don't need to.
 */
export async function removeWorktreeAny(
  host: string | undefined,
  parentRepo: string,
  worktreePath: string,
  options: RemoveWorktreeOptions = {},
): Promise<void> {
  if (host) {
    const { removeRemoteWorktree } = await import('./remote-manager');
    await removeRemoteWorktree(host, parentRepo, worktreePath, { onStage: options.onStage });
  } else {
    const { removeWorktree } = await import('./manager');
    await removeWorktree(parentRepo, worktreePath, {
      signal: options.signal,
      onStage: options.onStage,
    });
  }
}
