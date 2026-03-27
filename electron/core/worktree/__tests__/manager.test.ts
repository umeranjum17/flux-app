import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const createdWorktrees: Array<{ parentRepo: string; worktreePath: string }> = [];

vi.mock('electron', () => ({
  dialog: {
    showOpenDialogSync: vi.fn(),
  },
}));

// Restore the real child_process (setup-main.ts mocks it globally).
vi.mock('child_process', async () => vi.importActual('child_process'));

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-worktree-manager-'));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(repoDir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.name', 'Flux Test'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'user.email', 'flux@example.com'], { cwd: repoDir });
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repoDir });
}

afterEach(async () => {
  const { removeWorktree } = await import('../manager');

  while (createdWorktrees.length > 0) {
    const entry = createdWorktrees.pop();
    if (!entry) continue;
    try {
      await removeWorktree(entry.parentRepo, entry.worktreePath);
    } catch {
      fs.rmSync(entry.worktreePath, { recursive: true, force: true });
    }
  }

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('createWorktree', () => {
  it('creates the .context directory during worktree bootstrap', { timeout: 30000 }, async () => {
    const { createWorktree } = await import('../manager');
    const parentRepo = makeTempDir();
    await initRepo(parentRepo);

    const worktree = await createWorktree(parentRepo, 'flux/test-context', 'test-context');
    createdWorktrees.push({ parentRepo, worktreePath: worktree.path });

    expect(fs.existsSync(path.join(worktree.path, '.context'))).toBe(true);
  });
});
