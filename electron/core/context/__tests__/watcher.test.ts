import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextWatcher } from '../watcher';
import type { WorkspaceFs } from '../../worktree/workspace-fs';
import * as workspaceFsModule from '../../worktree/workspace-fs';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-context-watcher-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForWatcherToSettle(watcher: ContextWatcher): Promise<void> {
  await vi.waitFor(() => {
    expect((watcher as unknown as { polling: boolean }).polling).toBe(false);
  });
}

describe('ContextWatcher', () => {
  it('creates .context and polls immediately on start', async () => {
    const cwd = makeTempDir();
    const statePath = path.join(cwd, '.context', 'state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ outcome: 'planned' }));

    const seen: Array<Record<string, unknown>> = [];
    const watcher = new ContextWatcher({
      cwd,
      onStateChange: (state) => {
        seen.push(state as Record<string, unknown>);
      },
    });

    watcher.start();
    await vi.waitFor(() => expect(seen).toEqual([{ outcome: 'planned' }]));
    watcher.stop();

    expect(fs.existsSync(path.join(cwd, '.context'))).toBe(true);
    expect(seen).toEqual([{ outcome: 'planned' }]);
    expect(watcher.hasReceivedState).toBe(true);
  });

  it('treats empty todo lists as real state updates', async () => {
    const cwd = makeTempDir();
    const statePath = path.join(cwd, '.context', 'state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ todos: [] }));

    let seen: { todos?: unknown[] } | null = null;
    const watcher = new ContextWatcher({
      cwd,
      onStateChange: (state) => {
        seen = state;
      },
    });

    watcher.start();
    await vi.waitFor(() => expect(seen).toEqual({ todos: [] }));
    watcher.stop();

    expect(seen).toEqual({ todos: [] });
    expect(watcher.hasReceivedState).toBe(true);
  });

  it('ignores empty state objects', async () => {
    const cwd = makeTempDir();
    const statePath = path.join(cwd, '.context', 'state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({}));

    let callCount = 0;
    const watcher = new ContextWatcher({
      cwd,
      onStateChange: () => {
        callCount += 1;
      },
    });

    watcher.start();
    await waitForWatcherToSettle(watcher);
    watcher.stop();

    expect(callCount).toBe(0);
    expect(watcher.hasReceivedState).toBe(false);
  });

  it('leaves requests unclaimed when shouldProcessRequest returns false', async () => {
    const cwd = makeTempDir();
    const requestsDir = path.join(cwd, '.context', 'requests');
    fs.mkdirSync(requestsDir, { recursive: true });
    fs.writeFileSync(path.join(requestsDir, 'r1.json'), JSON.stringify({
      id: 'r1',
      action: 'terminal:spawn',
      payload: { command: 'npm run dev' },
    }));

    let callCount = 0;
    const watcher = new ContextWatcher({
      cwd,
      onStateChange: () => {},
      onRequest: () => {
        callCount += 1;
      },
      shouldProcessRequest: () => false,
    });

    watcher.start();
    await waitForWatcherToSettle(watcher);
    watcher.stop();

    expect(callCount).toBe(0);

    const secondWatcher = new ContextWatcher({
      cwd,
      onStateChange: () => {},
      onRequest: () => {
        callCount += 1;
      },
    });

    secondWatcher.start();
    await vi.waitFor(() => expect(callCount).toBe(1));
    secondWatcher.stop();

    expect(callCount).toBe(1);
  });

  it('does not replay fulfilled requests after watcher restart', async () => {
    const cwd = makeTempDir();
    const contextDir = path.join(cwd, '.context');
    const requestsDir = path.join(contextDir, 'requests');
    const responsesDir = path.join(contextDir, 'responses');
    fs.mkdirSync(requestsDir, { recursive: true });
    fs.mkdirSync(responsesDir, { recursive: true });
    fs.writeFileSync(path.join(requestsDir, 'r1.json'), JSON.stringify({
      id: 'r1',
      action: 'terminal:spawn',
      payload: { command: 'npm run dev' },
    }));
    fs.writeFileSync(path.join(responsesDir, 'r1.json'), JSON.stringify({
      id: 'r1',
      ok: true,
      data: { terminalId: 'term-1' },
    }));

    let callCount = 0;
    const watcher = new ContextWatcher({
      cwd,
      onStateChange: () => {},
      onRequest: () => {
        callCount += 1;
      },
    });

    watcher.start();
    await waitForWatcherToSettle(watcher);
    watcher.stop();

    const secondWatcher = new ContextWatcher({
      cwd,
      onStateChange: () => {},
      onRequest: () => {
        callCount += 1;
      },
    });

    secondWatcher.start();
    await waitForWatcherToSettle(secondWatcher);
    secondWatcher.stop();
    expect(callCount).toBe(0);
  });

  it('polls remote requests via WorkspaceFs.listDir', async () => {
    const cwd = "/tmp/quote's-workspace";
    const seenRequests: string[] = [];
    const fakeWfs: WorkspaceFs = {
      isRemote: true,
      sshHost: 'dev@example',
      git: async () => ({ stdout: '', stderr: '' }),
      readFile: async (filePath) => {
        if (filePath.endsWith('/state.json')) {
          return JSON.stringify({ outcome: 'in_progress' });
        }
        if (filePath.endsWith('/requests/r1.json')) {
          return JSON.stringify({
            id: 'r1',
            action: 'terminal:spawn',
            payload: { command: 'npm run dev' },
          });
        }
        return null;
      },
      writeFile: async () => {},
      writeBuffer: async () => {},
      exists: async () => false,
      listDir: async (dirPath) => {
        expect(dirPath).toBe("/tmp/quote's-workspace/.context/requests");
        return ['r1.json'];
      },
      mkdirp: async () => {},
      rmrf: async () => {},
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      diskUsage: async () => 0,
    };

    const createWorkspaceFsSpy = vi
      .spyOn(workspaceFsModule, 'createWorkspaceFs')
      .mockReturnValue(fakeWfs);

    try {
      const watcher = new ContextWatcher({
        cwd,
        sshHost: 'dev@example',
        onStateChange: () => {},
        onRequest: (request) => {
          seenRequests.push(request.id);
        },
      });

      watcher.start();
      await vi.waitFor(() => expect(seenRequests).toEqual(['r1']));
      watcher.stop();
    } finally {
      createWorkspaceFsSpy.mockRestore();
    }
  });
});
