import crypto from 'crypto';
import path from 'path';
import { sshExec, sshWriteFile } from '../tools/ssh';
import type { WorktreeInfo } from './types';

export function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Cache resolved $HOME per host to avoid repeated SSH round-trips. */
const remoteHomeCache = new Map<string, string>();

/** Clear cached $HOME for a host (call on SSH disconnect). Clears all if no host given. */
export function clearRemoteHomeCache(host?: string): void {
  if (host) {
    remoteHomeCache.delete(host);
  } else {
    remoteHomeCache.clear();
  }
}

async function resolveRemoteHome(host: string): Promise<string> {
  const cached = remoteHomeCache.get(host);
  if (cached) return cached;
  const result = await sshExec(host, 'echo "$HOME"', 5000);
  const home = result.stdout.trim();
  if (!home || !home.startsWith('/')) {
    throw new Error(`Failed to resolve remote $HOME on ${host}`);
  }
  remoteHomeCache.set(host, home);
  return home;
}

/**
 * Run a git command on a remote host via SSH.
 */
export async function remoteExecGit(
  host: string,
  cwd: string,
  args: string[],
  timeout = 30000,
): Promise<{ stdout: string; stderr: string }> {
  const escapedCwd = escapeShell(cwd);
  const command = `cd '${escapedCwd}' && git ${args.map((a) => `'${escapeShell(a)}'`).join(' ')}`;
  const result = await sshExec(host, command, timeout);
  if (result.exitCode !== 0) {
    throw new Error(`Remote git failed: ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

async function remoteWorktreeBaseDir(host: string, parentRepo: string): Promise<string> {
  const home = await resolveRemoteHome(host);
  const slug = path.basename(parentRepo) || 'root';
  const hash = crypto.createHash('md5').update(parentRepo).digest('hex').slice(0, 8);
  return `${home}/.flux/worktrees/${slug}-${hash}`;
}

/**
 * Create a git worktree on a remote host via SSH.
 */
export async function createRemoteWorktree(
  host: string,
  parentRepo: string,
  branchName: string,
  worktreeName?: string,
): Promise<WorktreeInfo> {
  const id = crypto.randomUUID();
  const baseDir = await remoteWorktreeBaseDir(host, parentRepo);
  const safeName = (worktreeName || branchName)
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, '')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'workspace';

  // Create base dir
  await sshExec(host, `mkdir -p '${escapeShell(baseDir)}'`);

  // Resolve unique worktree path — list the directory once to avoid O(n) SSH round-trips
  const { stdout: lsOut } = await sshExec(host, `ls -1 '${escapeShell(baseDir)}' 2>/dev/null || true`);
  const existing = new Set(lsOut.split('\n').map(l => l.trim()).filter(Boolean));
  let finalPath = `${baseDir}/${safeName}`;
  if (existing.has(safeName)) {
    for (let i = 2; i <= 999; i++) {
      const candidate = `${safeName}-${i}`;
      if (!existing.has(candidate)) {
        finalPath = `${baseDir}/${candidate}`;
        break;
      }
    }
  }

  // Ensure repo has at least one commit
  try {
    await remoteExecGit(host, parentRepo, ['rev-parse', 'HEAD']);
  } catch {
    await sshExec(host, `cd '${escapeShell(parentRepo)}' && git init && git commit --allow-empty -m 'Initial commit'`);
  }

  // Create the worktree
  await remoteExecGit(host, parentRepo, ['worktree', 'add', finalPath, '-b', branchName]);

  // Create .context dir
  await sshExec(host, `mkdir -p '${escapeShell(finalPath)}/.context'`);

  // Get HEAD
  const { stdout: headOut } = await remoteExecGit(host, finalPath, ['rev-parse', 'HEAD']);

  return {
    id,
    path: finalPath,
    branch: branchName,
    parentRepo,
    head: headOut.trim(),
  };
}

/**
 * Remove a git worktree on a remote host via SSH.
 */
export async function removeRemoteWorktree(
  host: string,
  parentRepo: string,
  worktreePath: string,
  options?: { onStage?: (stage: string) => void },
): Promise<void> {
  const onStage = options?.onStage;

  // Resolve branch name
  let branchName: string | null = null;
  try {
    onStage?.('resolving_branch');
    const { stdout } = await remoteExecGit(host, worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    branchName = stdout.trim();
  } catch {
    // Worktree may already be gone
  }

  // Remove git worktree
  try {
    onStage?.('removing_git_worktree');
    await remoteExecGit(host, parentRepo, ['worktree', 'remove', worktreePath, '--force']);
  } catch {
    // May already be gone
  }

  // Delete branch
  if (branchName && branchName !== 'HEAD') {
    try {
      onStage?.('removing_git_branch');
      await remoteExecGit(host, parentRepo, ['branch', '-D', branchName]);
    } catch {
      // Branch may already be gone
    }
  }

  // Clean up directory
  onStage?.('removing_worktree_files');
  const escaped = escapeShell(worktreePath);
  await sshExec(host, `rm -rf '${escaped}'`);
}

/**
 * Check if a path exists on a remote host.
 */
export async function remotePathExists(
  host: string,
  remotePath: string,
): Promise<boolean> {
  const result = await sshExec(host, `test -e '${escapeShell(remotePath)}' && echo 1 || echo 0`);
  return result.stdout.trim() === '1';
}

/**
 * Read a file on a remote host. Returns null if the file doesn't exist.
 */
export async function remoteReadFile(
  host: string,
  remotePath: string,
): Promise<string | null> {
  const result = await sshExec(host, `cat '${escapeShell(remotePath)}' 2>/dev/null`);
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

/**
 * Write content to a file on a remote host.
 */
export async function remoteWriteFile(
  host: string,
  remotePath: string,
  content: string,
): Promise<void> {
  await remoteWriteContent(host, remotePath, content);
}

export async function remoteWriteBuffer(
  host: string,
  remotePath: string,
  content: Uint8Array,
): Promise<void> {
  await remoteWriteContent(host, remotePath, content);
}

export async function remoteListDir(
  host: string,
  remotePath: string,
): Promise<string[]> {
  const result = await sshExec(host, `[ -d '${escapeShell(remotePath)}' ] && ls -1A -- '${escapeShell(remotePath)}' || true`);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function remoteWriteContent(
  host: string,
  remotePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
  if (dir) {
    await sshExec(host, `mkdir -p '${escapeShell(dir)}'`);
  }
  const result = await sshWriteFile(host, remotePath, content);
  if (!result.success) {
    throw new Error(result.error || `Failed to write remote file: ${remotePath}`);
  }
}

/**
 * Run an arbitrary shell command on a remote host.
 */
export async function remoteExec(
  host: string,
  cwd: string,
  command: string,
  timeout = 30000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const escapedCwd = escapeShell(cwd);
  const result = await sshExec(host, `cd '${escapedCwd}' && ${command}`, timeout);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
