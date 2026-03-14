import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const execFileMock = vi.mocked(execFile);
const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
let promiseCalls: string[] = [];

function getKey(args: string[], options?: { cwd?: string }) {
  return `${options?.cwd ?? ''}::${args.join(' ')}`;
}

function mockGitCalls(responses: Map<string, string | Error>) {
  promiseCalls = [];
  (execFileMock as typeof execFileMock & {
    [promisifyCustom]?: (command: string, args: string[], options?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
  })[promisifyCustom] = async (_command: string, args: string[], options?: { cwd?: string }) => {
    const key = getKey(args, options);
    promiseCalls.push(key);
    const response = responses.get(key);

    if (response instanceof Error) {
      throw response;
    }

    if (response === undefined) {
      throw new Error(`Unexpected execFile call: ${getKey(args, options)}`);
    }

    return {
      stdout: response,
      stderr: '',
    };
  };

  execFileMock.mockImplementation(((command, args, options, callback) => {
    const cb = callback as ExecFileCallback;
    const key = getKey(args as string[], options as { cwd?: string } | undefined);
    const response = responses.get(key);

    if (response instanceof Error) {
      cb(response, '', '');
      return {} as any;
    }

    if (response === undefined) {
      cb(new Error(`Unexpected execFile call: ${key}`), '', '');
      return {} as any;
    }

    cb(null, response, '');
    return {} as any;
  }) as typeof execFile);
}

beforeEach(() => {
  vi.resetModules();
  execFileMock.mockReset();
});

describe('worktree diff helpers', () => {
  it('resolves diffs against the parent repository HEAD instead of a hard-coded main branch', async () => {
    const parentRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-parent-'));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-worktree-'));
    fs.writeFileSync(path.join(worktreePath, 'new.ts'), 'line one\nline two\n', 'utf-8');

    mockGitCalls(new Map<string, string | Error>([
      [`${parentRepo}::rev-parse HEAD`, 'parent-sha\n'],
      [`${parentRepo}::rev-parse --abbrev-ref HEAD`, 'master\n'],
      [`${worktreePath}::symbolic-ref --quiet --short refs/remotes/origin/HEAD`, new Error('missing remote HEAD')],
      [`${worktreePath}::merge-base parent-sha HEAD`, 'base-sha\n'],
      [`${worktreePath}::diff --name-status --find-renames base-sha --`, 'M\ttracked.ts\n'],
      [`${worktreePath}::ls-files --others --exclude-standard`, 'new.ts\n'],
      [`${worktreePath}::diff --numstat --find-renames base-sha -- tracked.ts`, '4\t1\ttracked.ts\n'],
      [`${worktreePath}::diff --find-renames base-sha -- tracked.ts`, 'tracked diff\n'],
      [`${worktreePath}::diff --numstat --find-renames base-sha -- new.ts`, ''],
      [`${worktreePath}::diff --find-renames base-sha -- new.ts`, ''],
    ]));

    const { getChangedFiles } = await import('../diff');
    const files = await getChangedFiles(worktreePath, parentRepo);

    expect(files).toEqual([
      {
        path: 'tracked.ts',
        status: 'modified',
        additions: 4,
        deletions: 1,
        diff: 'tracked diff\n',
      },
      {
        path: 'new.ts',
        status: 'added',
        additions: 3,
        deletions: 0,
        diff: '',
      },
    ]);
  });

  it('restores files from the resolved base commit when discarding workspace changes', async () => {
    const parentRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-parent-'));
    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-worktree-'));

    mockGitCalls(new Map<string, string | Error>([
      [`${parentRepo}::rev-parse HEAD`, 'parent-sha\n'],
      [`${parentRepo}::rev-parse --abbrev-ref HEAD`, 'master\n'],
      [`${worktreePath}::symbolic-ref --quiet --short refs/remotes/origin/HEAD`, new Error('missing remote HEAD')],
      [`${worktreePath}::merge-base parent-sha HEAD`, 'base-sha\n'],
      [`${worktreePath}::cat-file -e base-sha:tracked.ts`, ''],
      [`${worktreePath}::checkout base-sha -- tracked.ts`, ''],
    ]));

    const { discardFile } = await import('../diff');
    await discardFile(worktreePath, 'tracked.ts', parentRepo);

    expect(promiseCalls).toContain(`${worktreePath}::checkout base-sha -- tracked.ts`);
  });
});
