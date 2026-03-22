/**
 * Diff operations for worktrees — works identically for local and remote (SSH).
 *
 * All functions use the WorkspaceFs abstraction internally, so callers never
 * need to branch on `sshHost`.  Pass the workspace's `sshHost` (or omit it
 * for local) and the right strategy is selected automatically.
 */
import path from 'path';
import type { DiffFile, DiffFileSections, DiffScope } from './types';
import { createWorkspaceFs, type WorkspaceFs } from './workspace-fs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function tryGit(wfs: WorkspaceFs, cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await wfs.git(cwd, args);
    return stdout;
  } catch {
    return null;
  }
}

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

function resolveWorktreeFilePath(worktreePath: string, filePath: string, sshHost?: string): string {
  const pathApi = sshHost ? path.posix : path;
  const root = pathApi.resolve(worktreePath);
  const resolved = pathApi.resolve(worktreePath, filePath);
  if (resolved === root || resolved.startsWith(`${root}${pathApi.sep}`)) {
    return resolved;
  }
  throw new Error(`File path escapes worktree: ${filePath}`);
}

// ---------------------------------------------------------------------------
// Diff base resolution
// ---------------------------------------------------------------------------

export async function resolveDiffBase(
  worktreePath: string,
  parentRepo?: string,
  sshHost?: string,
): Promise<string> {
  const wfs = createWorkspaceFs(sshHost);
  const candidates: string[] = [];

  if (parentRepo) {
    const parentHead = (await tryGit(wfs, parentRepo, ['rev-parse', 'HEAD']))?.trim();
    if (parentHead) {
      candidates.push(parentHead);
    }

    const parentBranch = (await tryGit(wfs, parentRepo, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
    if (parentBranch && parentBranch !== 'HEAD') {
      candidates.push(parentBranch, `origin/${parentBranch}`);
    }
  }

  const remoteHead = (await tryGit(wfs, worktreePath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  if (remoteHead) {
    candidates.push(remoteHead);
  }

  candidates.push('main', 'master');

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const mergeBase = (await tryGit(wfs, worktreePath, ['merge-base', candidate, 'HEAD']))?.trim();
    if (mergeBase) {
      return mergeBase;
    }
  }

  const previousHead = (await tryGit(wfs, worktreePath, ['rev-parse', 'HEAD~1']))?.trim();
  if (previousHead) {
    return previousHead;
  }

  const rootCommit = (await tryGit(wfs, worktreePath, ['rev-list', '--max-parents=0', 'HEAD']))?.trim();
  return rootCommit?.split('\n')[0] ?? 'HEAD';
}

// ---------------------------------------------------------------------------
// Changed file collection
// ---------------------------------------------------------------------------

async function collectChangedFiles(
  wfs: WorkspaceFs,
  worktreePath: string,
  diffTarget: string,
  includeUntracked: boolean,
): Promise<DiffFile[]> {
  const nameStatus = (await tryGit(wfs, worktreePath, ['diff', '--name-status', '--find-renames', diffTarget, '--'])) ?? '';

  const untrackedFiles: string[] = [];
  if (includeUntracked) {
    const output = await tryGit(wfs, worktreePath, ['ls-files', '--others', '--exclude-standard']);
    if (output) {
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) untrackedFiles.push(trimmed);
      }
    }
  }

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
      const numstat = await tryGit(wfs, worktreePath, ['diff', '--numstat', '--find-renames', diffTarget, '--', filePath]);
      const [addStr = '0', delStr = '0'] = (numstat ?? '').trim().split('\t');
      const additions = addStr === '-' ? 0 : parseInt(addStr, 10) || 0;
      const deletions = delStr === '-' ? 0 : parseInt(delStr, 10) || 0;
      const diff = await tryGit(wfs, worktreePath, ['diff', '--find-renames', diffTarget, '--', filePath]);

      if (status === 'added' && !diff) {
        const content = await wfs.readFile(`${worktreePath}/${filePath}`);
        files.push({
          path: filePath,
          status,
          additions: content ? content.split('\n').length : 0,
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getChangedFiles(
  worktreePath: string,
  parentRepo?: string,
  sshHost?: string,
): Promise<DiffFile[]> {
  const wfs = createWorkspaceFs(sshHost);
  const base = await resolveDiffBase(worktreePath, parentRepo, sshHost);
  return collectChangedFiles(wfs, worktreePath, base, true);
}

export async function getChangedFilesSeparated(
  worktreePath: string,
  parentRepo?: string,
  sshHost?: string,
): Promise<DiffFileSections> {
  const wfs = createWorkspaceFs(sshHost);
  const base = await resolveDiffBase(worktreePath, parentRepo, sshHost);

  const [committed, uncommitted] = await Promise.all([
    collectChangedFiles(wfs, worktreePath, `${base}..HEAD`, false),
    collectChangedFiles(wfs, worktreePath, 'HEAD', true),
  ]);

  return { committed, uncommitted };
}

export async function getFileDiff(
  worktreePath: string,
  filePath: string,
  parentRepo?: string,
  scope: DiffScope = 'all',
  sshHost?: string,
): Promise<{ oldContent: string; newContent: string; unified: string }> {
  const wfs = createWorkspaceFs(sshHost);
  const base = await resolveDiffBase(worktreePath, parentRepo, sshHost);
  const absoluteFilePath = resolveWorktreeFilePath(worktreePath, filePath, sshHost);

  const readAtRef = async (ref: string) => {
    try {
      const { stdout } = await wfs.git(worktreePath, ['show', `${ref}:${filePath}`]);
      return stdout;
    } catch {
      return '';
    }
  };

  if (scope === 'committed') {
    const oldContent = await readAtRef(base);
    const newContent = await readAtRef('HEAD');
    const unified = (await tryGit(wfs, worktreePath, ['diff', '--find-renames', `${base}..HEAD`, '--', filePath])) ?? '';
    return { oldContent, newContent, unified };
  }

  if (scope === 'uncommitted') {
    const oldContent = await readAtRef('HEAD');
    const newContent = (await wfs.readFile(absoluteFilePath)) ?? '';
    const unified = (await tryGit(wfs, worktreePath, ['diff', '--find-renames', 'HEAD', '--', filePath])) ?? '';
    return { oldContent, newContent, unified };
  }

  // scope === 'all'
  const oldContent = await readAtRef(base);
  const newContent = (await wfs.readFile(absoluteFilePath)) ?? '';
  const unified = (await tryGit(wfs, worktreePath, ['diff', '--find-renames', base, '--', filePath])) ?? '';
  return { oldContent, newContent, unified };
}

export async function getFullDiff(
  worktreePath: string,
  parentRepo?: string,
  sshHost?: string,
): Promise<string> {
  const wfs = createWorkspaceFs(sshHost);
  const base = await resolveDiffBase(worktreePath, parentRepo, sshHost);
  const { stdout } = await wfs.git(worktreePath, ['diff', base]);
  return stdout;
}

export async function discardFile(
  worktreePath: string,
  filePath: string,
  parentRepo?: string,
  scope: Exclude<DiffScope, 'committed'> = 'all',
  sshHost?: string,
): Promise<void> {
  const wfs = createWorkspaceFs(sshHost);
  const base = await resolveDiffBase(worktreePath, parentRepo, sshHost);
  const restoreRef = scope === 'uncommitted' ? 'HEAD' : base;
  const absoluteFilePath = resolveWorktreeFilePath(worktreePath, filePath, sshHost);

  // Check if the file exists at the restore ref
  let fileExistsInBase = false;
  try {
    await wfs.git(worktreePath, ['cat-file', '-e', `${restoreRef}:${filePath}`]);
    fileExistsInBase = true;
  } catch { /* doesn't exist */ }

  if (fileExistsInBase) {
    await wfs.git(worktreePath, ['checkout', restoreRef, '--', filePath]);
    return;
  }

  try {
    await wfs.git(worktreePath, ['rm', '-f', '--ignore-unmatch', '--', filePath]);
  } catch {
    // not tracked — remove from disk
  }

  // Fallback: ensure file is gone even if untracked (works for both local and remote)
  await wfs.rmrf(absoluteFilePath);
}

export async function discardAll(
  worktreePath: string,
  sshHost?: string,
): Promise<void> {
  const wfs = createWorkspaceFs(sshHost);
  await wfs.git(worktreePath, ['checkout', '.']);
  await wfs.git(worktreePath, ['clean', '-fd']);
}
