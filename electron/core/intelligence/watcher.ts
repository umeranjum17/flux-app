import type { FSWatcher } from 'chokidar';
import type { RepoMapConfig } from './types';

let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingInvalidations = new Set<string>();

type InvalidateCallback = (filePath: string) => void;

export async function startWatcher(
  projectPath: string,
  config: RepoMapConfig,
  onInvalidate: InvalidateCallback,
): Promise<void> {
  await stopWatcher();

  // Dynamically import chokidar to avoid issues when not installed
  const chokidar = await import('chokidar');

  watcher = chokidar.watch(config.indexedFilePatterns, {
    cwd: projectPath,
    ignored: config.excludePatterns,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const scheduleFlush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const filePath of pendingInvalidations) {
        onInvalidate(filePath);
      }
      pendingInvalidations.clear();
    }, 500);
  };

  watcher.on('add', (filePath) => {
    pendingInvalidations.add(filePath);
    scheduleFlush();
  });

  watcher.on('change', (filePath) => {
    pendingInvalidations.add(filePath);
    scheduleFlush();
  });

  watcher.on('unlink', (filePath) => {
    pendingInvalidations.add(filePath);
    scheduleFlush();
  });
}

export async function stopWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingInvalidations.clear();

  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

export function isWatcherRunning(): boolean {
  return watcher !== null;
}
