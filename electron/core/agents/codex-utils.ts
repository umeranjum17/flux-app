import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SpawnOptions, ThinkingLevel } from './types';

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');
const CODEX_SESSIONS_PATH = path.join(os.homedir(), '.codex', 'sessions');
const SESSION_LOOKUP_SKEW_MS = 60_000;

export interface CodexSessionMeta {
  id: string;
  cwd: string;
  createdAt: number;
  filePath?: string;
}

export function mapCodexReasoningEffort(
  thinking?: ThinkingLevel,
): ThinkingLevel | undefined {
  if (thinking === 'xhigh') return 'high';
  return thinking;
}

export function inferCodexProfile(
  options: Pick<SpawnOptions, 'mode' | 'prompt'>,
): 'deep' | 'fast' | 'bulk' {
  if (options.mode === 'plan') {
    return 'deep';
  }

  if (/(bulk|codemod|rename\b|migrate|mechanical|sweep|across multiple files|mass update|repo-wide)/i.test(options.prompt)) {
    return 'bulk';
  }

  return 'fast';
}

export function hasCodexProfile(profile: string): boolean {
  return listCodexProfiles().has(profile);
}

export function listCodexProfiles(configPath = CODEX_CONFIG_PATH): Set<string> {
  try {
    const config = fs.readFileSync(configPath, 'utf-8');
    const matches = config.matchAll(/^\[profiles\.([^\]]+)\]\s*$/gm);
    return new Set(Array.from(matches, (match) => match[1]));
  } catch {
    return new Set();
  }
}

export function extractCodexSessionMeta(event: unknown): CodexSessionMeta | null {
  if (!isRecord(event)) return null;
  if (event.type !== 'session_meta') return null;
  if (!isRecord(event.payload)) return null;

  const id = event.payload.id;
  const cwd = event.payload.cwd;
  const timestamp = event.payload.timestamp ?? event.timestamp;

  if (typeof id !== 'string' || typeof cwd !== 'string' || typeof timestamp !== 'string') {
    return null;
  }

  const createdAt = Date.parse(timestamp);
  if (Number.isNaN(createdAt)) {
    return null;
  }

  return { id, cwd, createdAt };
}

export function findLatestCodexSession(
  targetCwd: string,
  startedAt: number,
  options?: { sessionsDir?: string; limit?: number },
): CodexSessionMeta | null {
  const sessionsDir = options?.sessionsDir ?? CODEX_SESSIONS_PATH;
  const limit = options?.limit ?? 40;
  const normalizedCwd = path.resolve(targetCwd);

  const candidates = collectSessionFiles(sessionsDir)
    .filter((entry) => entry.mtimeMs >= startedAt - SESSION_LOOKUP_SKEW_MS)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit);

  for (const candidate of candidates) {
    const meta = readSessionMetaFromFile(candidate.filePath);
    if (!meta) continue;
    if (path.resolve(meta.cwd) !== normalizedCwd) continue;
    if (meta.createdAt < startedAt - SESSION_LOOKUP_SKEW_MS) continue;
    return { ...meta, filePath: candidate.filePath };
  }

  return null;
}

function collectSessionFiles(rootDir: string): Array<{ filePath: string; mtimeMs: number }> {
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const files: Array<{ filePath: string; mtimeMs: number }> = [];

    for (const entry of entries) {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSessionFiles(entryPath));
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      try {
        const stats = fs.statSync(entryPath);
        files.push({ filePath: entryPath, mtimeMs: stats.mtimeMs });
      } catch {
        // Ignore session files that disappear mid-scan.
      }
    }

    return files;
  } catch {
    return [];
  }
}

function readSessionMetaFromFile(filePath: string): CodexSessionMeta | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(24 * 1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const preview = buffer.subarray(0, bytesRead).toString('utf-8');
    const firstLine = preview.split('\n')[0]?.trim();
    if (!firstLine) return null;

    const parsed = JSON.parse(firstLine) as unknown;
    const meta = extractCodexSessionMeta(parsed);
    return meta ? { ...meta, filePath } : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
