import { execFile } from 'child_process';
import { promisify } from 'util';
import type { DiffFile } from './types';

const execFileAsync = promisify(execFile);

export async function getChangedFiles(worktreePath: string, baseBranch = 'main'): Promise<DiffFile[]> {
  // Find the merge base
  let base: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge-base', baseBranch, 'HEAD'],
      { cwd: worktreePath, timeout: 10000 },
    );
    base = stdout.trim();
  } catch {
    // If no merge base found, diff against the first commit
    base = 'HEAD~1';
  }

  const { stdout: nameStatus } = await execFileAsync(
    'git',
    ['diff', base, 'HEAD', '--name-status'],
    { cwd: worktreePath, timeout: 30000 },
  );

  if (!nameStatus.trim()) return [];

  const files: DiffFile[] = [];
  for (const line of nameStatus.trim().split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const statusChar = parts[0].charAt(0);
    const filePath = parts[parts.length - 1];

    let status: DiffFile['status'] = 'modified';
    if (statusChar === 'A') status = 'added';
    else if (statusChar === 'D') status = 'deleted';
    else if (statusChar === 'R') status = 'renamed';

    // Get numstat for this file
    try {
      const { stdout: numstat } = await execFileAsync(
        'git',
        ['diff', base, 'HEAD', '--numstat', '--', filePath],
        { cwd: worktreePath, timeout: 10000 },
      );
      const [addStr, delStr] = numstat.trim().split('\t');
      const additions = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
      const deletions = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;

      const { stdout: diff } = await execFileAsync(
        'git',
        ['diff', base, 'HEAD', '--', filePath],
        { cwd: worktreePath, timeout: 10000 },
      );

      files.push({ path: filePath, status, additions, deletions, diff });
    } catch {
      files.push({ path: filePath, status, additions: 0, deletions: 0, diff: '' });
    }
  }

  return files;
}

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
  baseBranch = 'main',
): Promise<{ oldContent: string; newContent: string; unified: string }> {
  let base: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge-base', baseBranch, 'HEAD'],
      { cwd: worktreePath, timeout: 10000 },
    );
    base = stdout.trim();
  } catch {
    base = 'HEAD~1';
  }

  // Get old content
  let oldContent = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${base}:${filePath}`],
      { cwd: worktreePath, timeout: 10000 },
    );
    oldContent = stdout;
  } catch {
    // File didn't exist in base
  }

  // Get new content
  let newContent = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `HEAD:${filePath}`],
      { cwd: worktreePath, timeout: 10000 },
    );
    newContent = stdout;
  } catch {
    // File was deleted
  }

  // Get unified diff
  let unified = '';
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', base, 'HEAD', '--', filePath],
      { cwd: worktreePath, timeout: 10000 },
    );
    unified = stdout;
  } catch {
    // No diff
  }

  return { oldContent, newContent, unified };
}

export async function getFullDiff(worktreePath: string, baseBranch = 'main'): Promise<string> {
  let base: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge-base', baseBranch, 'HEAD'],
      { cwd: worktreePath, timeout: 10000 },
    );
    base = stdout.trim();
  } catch {
    base = 'HEAD~1';
  }

  const { stdout } = await execFileAsync(
    'git',
    ['diff', base, 'HEAD'],
    { cwd: worktreePath, timeout: 60000 },
  );
  return stdout;
}

export async function discardFile(worktreePath: string, filePath: string): Promise<void> {
  await execFileAsync('git', ['checkout', 'HEAD', '--', filePath], {
    cwd: worktreePath,
    timeout: 10000,
  });
}

export async function discardAll(worktreePath: string): Promise<void> {
  await execFileAsync('git', ['checkout', '.'], {
    cwd: worktreePath,
    timeout: 10000,
  });
  await execFileAsync('git', ['clean', '-fd'], {
    cwd: worktreePath,
    timeout: 10000,
  });
}
