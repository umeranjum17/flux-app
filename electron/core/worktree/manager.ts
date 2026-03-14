import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { dialog } from 'electron';
import type { WorktreeInfo, DiffFile, MergeResult } from './types';

const execFileAsync = promisify(execFile);

function worktreeBaseDir(parentRepo: string): string {
  const slug = path.basename(parentRepo) || 'root';
  const hash = crypto.createHash('md5').update(parentRepo).digest('hex').slice(0, 8);
  return path.join(os.homedir(), '.flux', 'worktrees', `${slug}-${hash}`);
}

function ensureBaseDir(baseDir: string): string {
  if (fs.existsSync(baseDir)) return baseDir;

  try {
    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
  } catch (err: any) {
    if (err.code !== 'EACCES') throw err;

    const result = dialog.showOpenDialogSync({
      title: 'Choose a directory for workspace worktrees',
      message: `Flux doesn't have permission to create worktrees at "${baseDir}". Please choose a writable location.`,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (!result || result.length === 0) {
      throw new Error('Workspace creation cancelled — no writable directory was selected');
    }

    const chosen = path.join(result[0], '.flux-worktrees');
    fs.mkdirSync(chosen, { recursive: true });
    return chosen;
  }
}

export async function createWorktree(
  parentRepo: string,
  branchName: string,
): Promise<WorktreeInfo> {
  const id = crypto.randomUUID();
  const baseDir = ensureBaseDir(worktreeBaseDir(parentRepo));

  const worktreePath = path.join(baseDir, id);

  await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
    cwd: parentRepo,
    timeout: 30000,
  });

  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    timeout: 10000,
  });

  return {
    id,
    path: worktreePath,
    branch: branchName,
    parentRepo,
    head: head.trim(),
  };
}

export async function removeWorktree(parentRepo: string, worktreePath: string): Promise<void> {
  let branchName: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktreePath,
      timeout: 10000,
    });
    branchName = stdout.trim();
  } catch {
    branchName = null;
  }

  await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
    cwd: parentRepo,
    timeout: 30000,
  });

  // Also delete the branch
  if (branchName && branchName !== 'HEAD') {
    try {
      await execFileAsync('git', ['branch', '-D', branchName], {
        cwd: parentRepo,
        timeout: 10000,
      });
    } catch {
      // Branch may already be gone
    }
  }
}

export async function listWorktrees(parentRepo: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
    cwd: parentRepo,
    timeout: 10000,
  });

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.slice(9), parentRepo };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          id: path.basename(current.path),
          path: current.path,
          branch: current.branch ?? 'detached',
          parentRepo,
          head: current.head ?? '',
        });
      }
      current = {};
    }
  }

  // Filter to only flux-managed worktrees
  const baseDir = worktreeBaseDir(parentRepo);
  return worktrees.filter((wt) => wt.path.startsWith(baseDir));
}

export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  // Diff between the worktree branch and its merge-base with the parent
  try {
    const { stdout: mergeBase } = await execFileAsync(
      'git',
      ['merge-base', 'HEAD', 'HEAD~0'],
      { cwd: worktreePath, timeout: 10000 },
    );

    // Get all changes: staged + unstaged + untracked (as new files)
    // First stage everything
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, timeout: 10000 });

    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', 'HEAD~0'],
      { cwd: worktreePath, timeout: 30000 },
    );
    return stdout;
  } catch {
    // Fallback: just get uncommitted changes
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], {
      cwd: worktreePath,
      timeout: 30000,
    });
    return stdout;
  }
}

export async function getWorktreeDiffFiles(worktreePath: string): Promise<DiffFile[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--numstat', '--diff-filter=ADMR', 'HEAD~0'],
      { cwd: worktreePath, timeout: 30000 },
    );

    if (!stdout.trim()) return [];

    const files: DiffFile[] = [];

    for (const line of stdout.trim().split('\n')) {
      const [addStr, delStr, filePath] = line.split('\t');
      if (!filePath) continue;

      const additions = addStr === '-' ? 0 : parseInt(addStr, 10);
      const deletions = delStr === '-' ? 0 : parseInt(delStr, 10);

      // Get the diff for this specific file
      const { stdout: fileDiff } = await execFileAsync(
        'git',
        ['diff', 'HEAD~0', '--', filePath],
        { cwd: worktreePath, timeout: 10000 },
      );

      // Determine status
      let status: DiffFile['status'] = 'modified';
      if (fileDiff.includes('new file mode')) status = 'added';
      else if (fileDiff.includes('deleted file mode')) status = 'deleted';
      else if (fileDiff.includes('rename from')) status = 'renamed';

      files.push({ path: filePath, status, additions, deletions, diff: fileDiff });
    }

    return files;
  } catch {
    return [];
  }
}

export async function mergeWorktree(
  worktreePath: string,
  parentRepo: string,
  targetBranch: string,
  squash = false,
): Promise<MergeResult> {
  // Get the branch name of the worktree
  const { stdout: branchRaw } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: worktreePath, timeout: 10000 },
  );
  const branch = branchRaw.trim();

  // Commit any uncommitted changes in the worktree first
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, timeout: 10000 });
    await execFileAsync(
      'git',
      ['commit', '-m', `[flux] Final changes from workspace ${path.basename(worktreePath)}`],
      { cwd: worktreePath, timeout: 10000 },
    );
  } catch {
    // Nothing to commit is fine
  }

  // Merge into target branch from the parent repo
  try {
    const mergeArgs = squash
      ? ['merge', '--squash', branch]
      : ['merge', branch, '--no-edit'];

    await execFileAsync('git', ['checkout', targetBranch], {
      cwd: parentRepo,
      timeout: 10000,
    });

    await execFileAsync('git', mergeArgs, {
      cwd: parentRepo,
      timeout: 30000,
    });

    if (squash) {
      // Squash merge needs a manual commit
      await execFileAsync(
        'git',
        ['commit', '-m', `[flux] Merge workspace: ${branch}`],
        { cwd: parentRepo, timeout: 10000 },
      );
    }

    return { success: true };
  } catch (err: any) {
    // Check for merge conflicts
    try {
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: parentRepo,
        timeout: 10000,
      });
      const conflicts = statusOut
        .split('\n')
        .filter((line) => line.startsWith('UU') || line.startsWith('AA'))
        .map((line) => line.slice(3).trim());

      if (conflicts.length > 0) {
        // Abort the merge
        await execFileAsync('git', ['merge', '--abort'], {
          cwd: parentRepo,
          timeout: 10000,
        });
        return { success: false, conflicts };
      }
    } catch {
      // Status check failed
    }

    return { success: false, error: err.message };
  }
}
