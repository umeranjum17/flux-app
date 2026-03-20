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

  it('leaves requests unclaimed when shouldProcessRequest returns false', () => {
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
    secondWatcher.stop();

    expect(callCount).toBe(1);
  });

  it('does not reprocess requests that already have responses', () => {
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
      data: { terminalId: 'terminal-1' },
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
    watcher.stop();

    expect(callCount).toBe(0);
  });
});
