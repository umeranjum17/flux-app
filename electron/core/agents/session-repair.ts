import { readFileSync, appendFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Find all JSONL files for a given session ID across all project directories.
 * The session may have been created from a different CWD (e.g., a worktree),
 * so we search globally rather than only in the current project's directory.
 */
export function findSessionJsonlPaths(sessionId: string): string[] {
  const projectsDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(projectsDir)) return [];

  const paths: string[] = [];
  try {
    for (const dir of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const jsonlPath = join(projectsDir, dir.name, `${sessionId}.jsonl`);
      if (existsSync(jsonlPath)) {
        paths.push(jsonlPath);
      }
    }
  } catch { /* best-effort */ }
  return paths;
}

/**
 * Repair a single session JSONL file by balancing orphaned queue-operation entries.
 * Returns true if repairs were applied.
 */
export function repairSessionJsonl(jsonlPath: string, sessionId: string): boolean {
  try {
    const content = readFileSync(jsonlPath, 'utf-8');
    let enqueueCount = 0;
    let removeCount = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'queue-operation') {
          if (entry.operation === 'enqueue') enqueueCount++;
          else if (entry.operation === 'remove' || entry.operation === 'dequeue') removeCount++;
        }
      } catch { /* skip malformed lines */ }
    }

    const pending = enqueueCount - removeCount;
    if (pending > 0) {
      const now = new Date().toISOString();
      const repairs = Array.from({ length: pending }, () =>
        JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: now, sessionId }),
      ).join('\n');
      appendFileSync(jsonlPath, '\n' + repairs + '\n');
      return true;
    }
  } catch { /* best-effort repair */ }
  return false;
}

/**
 * Repair orphaned queue-operation entries in Claude session JSONL files.
 * When a process is killed (SIGKILL), it can't write the final "remove" entry,
 * leaving the session in a permanently "in use" state.
 *
 * Searches all project directories since the session may have been created
 * from a different CWD (e.g., a worktree that no longer exists).
 */
export function repairSessionQueue(sessionId: string, cwd: string): void {
  const projectKey = cwd.replace(/\//g, '-');
  const expectedPath = join(homedir(), '.claude', 'projects', projectKey, `${sessionId}.jsonl`);
  if (existsSync(expectedPath)) {
    repairSessionJsonl(expectedPath, sessionId);
  }

  for (const path of findSessionJsonlPaths(sessionId)) {
    if (path !== expectedPath) {
      repairSessionJsonl(path, sessionId);
    }
  }
}

/**
 * Check if an error message indicates a session lock conflict.
 */
export function isSessionLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  return lower.includes('already in use')
    || lower.includes('session lock')
    || lower.includes('session is locked')
    || lower.includes('session_locked');
}
