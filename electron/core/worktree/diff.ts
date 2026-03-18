import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { DiffFile, DiffFileSections, DiffScope } from './types';

const execFileAsync = promisify(execFile);

async function runGit(
  cwd: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30000,
  });
  return stdout;
}

async function tryGit(
  cwd: string,
  args: string[],
): Promise<string | null> {
  try {
    return await runGit(cwd, args);
  } catch {
    return null;
  }
}

async function resolveDiffBase(worktreePath: string, parentRepo?: string): Promise<string> {
  const candidates: string[] = [];

  if (parentRepo) {
    const parentHead = (await tryGit(parentRepo, ['rev-parse', 'HEAD']))?.trim();
    if (parentHead) {
      candidates.push(parentHead);
    }

    const parentBranch = (await tryGit(parentRepo, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
    if (parentBranch && parentBranch !== 'HEAD') {
      candidates.push(parentBranch, `origin/${parentBranch}`);
    }
  }

  const remoteHead = (await tryGit(worktreePath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  if (remoteHead) {
    candidates.push(remoteHead);
  }

  candidates.push('main', 'master');

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const mergeBase = (await tryGit(worktreePath, ['merge-base', candidate, 'HEAD']))?.trim();
    if (mergeBase) {
      return mergeBase;
    }
  }

  const previousHead = (await tryGit(worktreePath, ['rev-parse', 'HEAD~1']))?.trim();
  if (previousHead) {
    return previousHead;
  }

  const rootCommit = (await tryGit(worktreePath, ['rev-list', '--max-parents=0', 'HEAD']))?.trim();
  return rootCommit?.split('\n')[0] ?? 'HEAD';
}

async function listUntrackedFiles(worktreePath: string): Promise<string[]> {
  const output = await tryGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function readWorkingTreeFile(worktreePath: string, filePath: string): Promise<string> {
  try {
    return await fs.readFile(path.join(worktreePath, filePath), 'utf-8');
  } catch {
    return '';
  }
}

async function readFileAtRef(worktreePath: string, ref: string, filePath: string): Promise<string> {
  try {
    return await runGit(worktreePath, ['show', `${ref}:${filePath}`]);
  } catch {
    return '';
  }
}

function countContentLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

/**
 * Count additions/deletions by parsing a unified diff string.
 * Used as a fallback when `git diff --numstat` returns 0 or empty.
 */
function countFromUnifiedDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

export async function getChangedFiles(worktreePath: string, parentRepo?: string): Promise<DiffFile[]> {
  const base = await resolveDiffBase(worktreePath, parentRepo);
  return collectChangedFiles(worktreePath, base, true);
}

export async function getChangedFilesSeparated(worktreePath: string, parentRepo?: string): Promise<DiffFileSections> {
  const base = await resolveDiffBase(worktreePath, parentRepo);

  const [committed, uncommitted] = await Promise.all([
    collectChangedFiles(worktreePath, `${base}..HEAD`, false),
    collectChangedFiles(worktreePath, 'HEAD', true),
  ]);

  return { committed, uncommitted };
}

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
  parentRepo?: string,
  scope: DiffScope = 'all',
): Promise<{ oldContent: string; newContent: string; unified: string }> {
  const base = await resolveDiffBase(worktreePath, parentRepo);

  if (scope === 'committed') {
    const oldContent = await readFileAtRef(worktreePath, base, filePath);
    const newContent = await readFileAtRef(worktreePath, 'HEAD', filePath);
    const unified = await tryGit(
      worktreePath,
      ['diff', '--find-renames', `${base}..HEAD`, '--', filePath],
    ) ?? '';
    return { oldContent, newContent, unified };
  }

  if (scope === 'uncommitted') {
    const oldContent = await readFileAtRef(worktreePath, 'HEAD', filePath);
    const newContent = await readWorkingTreeFile(worktreePath, filePath);
    const unified = await tryGit(
      worktreePath,
      ['diff', '--find-renames', 'HEAD', '--', filePath],
    ) ?? '';
    return { oldContent, newContent, unified };
  }

  const oldContent = await readFileAtRef(worktreePath, base, filePath);
  const newContent = await readWorkingTreeFile(worktreePath, filePath);

  // Get unified diff
  const unified = await tryGit(
    worktreePath,
    ['diff', '--find-renames', base, '--', filePath],
  ) ?? '';

  return { oldContent, newContent, unified };
}

export async function getFullDiff(worktreePath: string, parentRepo?: string): Promise<string> {
  const base = await resolveDiffBase(worktreePath, parentRepo);
  return runGit(worktreePath, ['diff', base]);
}

async function fileExistsInRef(worktreePath: string, ref: string, filePath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${ref}:${filePath}`], {
      cwd: worktreePath,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function discardFile(
  worktreePath: string,
  filePath: string,
  parentRepo?: string,
  scope: Exclude<DiffScope, 'committed'> = 'all',
): Promise<void> {
  const base = await resolveDiffBase(worktreePath, parentRepo);
  const restoreRef = scope === 'uncommitted' ? 'HEAD' : base;
  const fileExistsInBase = await fileExistsInRef(worktreePath, restoreRef, filePath);

  if (fileExistsInBase) {
    await execFileAsync('git', ['checkout', restoreRef, '--', filePath], {
      cwd: worktreePath,
      timeout: 10000,
    });
    return;
  }

  try {
    await execFileAsync('git', ['rm', '-f', '--ignore-unmatch', '--', filePath], {
      cwd: worktreePath,
      timeout: 10000,
    });
  } catch {
    // If the file is not tracked, fall back to removing it from disk.
  }

  await fs.rm(path.join(worktreePath, filePath), { force: true, recursive: true });
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

async function collectChangedFiles(
  worktreePath: string,
  diffTarget: string,
  includeUntracked: boolean,
): Promise<DiffFile[]> {
  const nameStatus = await runGit(
    worktreePath,
    ['diff', '--name-status', '--find-renames', diffTarget, '--'],
  );
  const untrackedFiles = includeUntracked ? await listUntrackedFiles(worktreePath) : [];

  const entries = new Map<string, DiffFile['status']>();
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    const statusChar = parts[0].charAt(0);
    const filePath = parts[parts.length - 1];

    let status: DiffFile['status'] = 'modified';
    if (statusChar === 'A') status = 'added';
    else if (statusChar === 'D') status = 'deleted';
    else if (statusChar === 'R') status = 'renamed';

    entries.set(filePath, status);
  }

  for (const filePath of untrackedFiles) {
    if (!entries.has(filePath)) {
      entries.set(filePath, 'added');
    }
  }

  if (entries.size === 0) return [];

  const files: DiffFile[] = [];

  for (const [filePath, status] of entries) {
    try {
      const numstat = await tryGit(
        worktreePath,
        ['diff', '--numstat', '--find-renames', diffTarget, '--', filePath],
      );
      const [addStr = '0', delStr = '0'] = (numstat ?? '').trim().split('\t');
      const additions = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
      const deletions = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
      const diff = await tryGit(
        worktreePath,
        ['diff', '--find-renames', diffTarget, '--', filePath],
      );

      if (status === 'added' && !diff) {
        const content = await readWorkingTreeFile(worktreePath, filePath);
        files.push({
          path: filePath,
          status,
          additions: countContentLines(content),
          deletions: 0,
          diff: '',
        });
        continue;
      }

      let finalAdditions = additions;
      let finalDeletions = deletions;

      if (finalAdditions === 0 && finalDeletions === 0 && diff) {
        const counted = countFromUnifiedDiff(diff);
        finalAdditions = counted.additions;
        finalDeletions = counted.deletions;
      }

      files.push({
        path: filePath,
        status,
        additions: finalAdditions,
        deletions: finalDeletions,
        diff: diff ?? '',
      });
    } catch {
      files.push({ path: filePath, status, additions: 0, deletions: 0, diff: '' });
    }
  }

  return files;
}
