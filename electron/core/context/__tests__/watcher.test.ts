import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextWatcher } from '../watcher';

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

describe('ContextWatcher', () => {
  it('creates .context and polls immediately on start', () => {
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
    watcher.stop();

    expect(fs.existsSync(path.join(cwd, '.context'))).toBe(true);
    expect(seen).toEqual([{ outcome: 'planned' }]);
    expect(watcher.hasReceivedState).toBe(true);
  });

  it('treats empty todo lists as real state updates', () => {
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
    watcher.stop();

    expect(seen).toEqual({ todos: [] });
    expect(watcher.hasReceivedState).toBe(true);
  });

  it('ignores empty state objects', () => {
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
    watcher.stop();

    expect(callCount).toBe(0);
    expect(watcher.hasReceivedState).toBe(false);
  });
});
