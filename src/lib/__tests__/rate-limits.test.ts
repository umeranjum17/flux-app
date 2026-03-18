import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coerceRateLimitStatus,
  computeHighestSeverity,
  formatTimeUntil,
  mergeRateLimits,
  normalizeTaskRateLimit,
  providerLabel,
  rateLimitTextColor,
  resolveRateLimitProvider,
} from '../rate-limits';

afterEach(() => {
  vi.useRealTimers();
});

describe('rate limit helpers', () => {
  it('normalizes active task rate limits with inferred provider ids', () => {
    expect(normalizeTaskRateLimit({ utilization: 0.84, rateLimitType: 'five_hour' }, 'codex')).toEqual({
      providerId: 'codex',
      status: 'allowed_warning',
      resetsAt: 0,
      rateLimitType: 'five_hour',
      utilization: 0.84,
    });
  });

  it('dedupes cached entries with active task data', () => {
    expect(mergeRateLimits([
      { providerId: 'codex', status: 'allowed', resetsAt: 1, rateLimitType: 'five_hour', utilization: 0.2 },
    ], {
      providerId: 'codex',
      status: 'rejected',
      resetsAt: 2,
      rateLimitType: 'five_hour',
      utilization: 1,
    })).toEqual([
      { providerId: 'codex', status: 'rejected', resetsAt: 2, rateLimitType: 'five_hour', utilization: 1 },
    ]);
  });

  it('computes severity and text colors consistently', () => {
    expect(coerceRateLimitStatus(undefined, 1)).toBe('rejected');
    expect(computeHighestSeverity([
      { providerId: 'claude-code', status: 'allowed', resetsAt: 1, rateLimitType: 'five_hour', utilization: 0.2 },
      { providerId: 'codex', status: 'allowed_warning', resetsAt: 1, rateLimitType: 'five_hour', utilization: 0.8 },
    ])).toBe('allowed_warning');
    expect(rateLimitTextColor({ status: 'allowed_warning' })).toBe('text-warning');
    expect(providerLabel('claude-code')).toBe('Claude Code');
  });

  it('maps agent ids to supported rate-limit providers', () => {
    expect(resolveRateLimitProvider('claude-code')).toBe('claude-code');
    expect(resolveRateLimitProvider('codex')).toBe('codex');
    expect(resolveRateLimitProvider('openai')).toBeNull();
  });

  it('formats reset times compactly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00Z'));
    expect(formatTimeUntil(Date.parse('2026-03-17T12:45:00Z'))).toBe('45m');
    expect(formatTimeUntil(Date.parse('2026-03-17T14:15:00Z'))).toBe('2h 15m');
  });
});
