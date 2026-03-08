import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  extractCodexSessionMeta,
  findLatestCodexSession,
  hasCodexProfile,
  inferCodexProfile,
  listCodexProfiles,
  mapCodexReasoningEffort,
} from '../codex-utils';

describe('mapCodexReasoningEffort', () => {
  it('passes through supported thinking levels', () => {
    expect(mapCodexReasoningEffort('low')).toBe('low');
    expect(mapCodexReasoningEffort('medium')).toBe('medium');
    expect(mapCodexReasoningEffort('high')).toBe('high');
    expect(mapCodexReasoningEffort('xhigh')).toBe('xhigh');
  });
});

describe('inferCodexProfile', () => {
  it('uses deep for plan mode', () => {
    expect(inferCodexProfile({ mode: 'plan', prompt: 'Design this system' })).toBe('deep');
  });

  it('uses bulk for mechanical repo-wide prompts', () => {
    expect(inferCodexProfile({ mode: 'act', prompt: 'Rename this symbol across multiple files' })).toBe('bulk');
  });

  it('uses fast for default act prompts', () => {
    expect(inferCodexProfile({ mode: 'act', prompt: 'Fix the failing test' })).toBe('fast');
  });
});

describe('profile lookup', () => {
  it('reads named profiles from config', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-codex-config-'));
    const configPath = path.join(tempDir, 'config.toml');
    fs.writeFileSync(configPath, '[profiles.deep]\nmodel="gpt-5.4"\n\n[profiles.bulk]\nmodel="gpt-5.3-codex"\n');

    expect(listCodexProfiles(configPath)).toEqual(new Set(['deep', 'bulk']));
  });

  it('returns false when a profile is missing', () => {
    expect(hasCodexProfile('definitely-missing-profile')).toBe(false);
  });
});

describe('extractCodexSessionMeta', () => {
  it('parses a session_meta event', () => {
    const meta = extractCodexSessionMeta({
      type: 'session_meta',
      payload: {
        id: 'session-123',
        cwd: '/workspace',
        timestamp: '2026-03-08T10:00:00.000Z',
      },
    });

    expect(meta).toEqual({
      id: 'session-123',
      cwd: '/workspace',
      createdAt: Date.parse('2026-03-08T10:00:00.000Z'),
    });
  });
});

describe('findLatestCodexSession', () => {
  it('finds the most recent matching cwd session created after the run start', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-codex-sessions-'));
    const dayDir = path.join(rootDir, '2026', '03', '08');
    fs.mkdirSync(dayDir, { recursive: true });

    const ignoredPath = path.join(dayDir, 'ignored.jsonl');
    fs.writeFileSync(
      ignoredPath,
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'ignored',
          cwd: '/other',
          timestamp: '2026-03-08T09:59:00.000Z',
        },
      })}\n`,
    );
    fs.utimesSync(ignoredPath, new Date('2026-03-08T10:00:00.000Z'), new Date('2026-03-08T10:00:00.000Z'));

    const matchingPath = path.join(dayDir, 'match.jsonl');
    fs.writeFileSync(
      matchingPath,
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'match',
          cwd: '/workspace',
          timestamp: '2026-03-08T10:01:00.000Z',
        },
      })}\n`,
    );
    fs.utimesSync(matchingPath, new Date('2026-03-08T10:01:30.000Z'), new Date('2026-03-08T10:01:30.000Z'));

    const result = findLatestCodexSession('/workspace', Date.parse('2026-03-08T10:00:30.000Z'), {
      sessionsDir: rootDir,
    });

    expect(result?.id).toBe('match');
    expect(result?.cwd).toBe('/workspace');
    expect(result?.filePath).toBe(matchingPath);
  });
});
