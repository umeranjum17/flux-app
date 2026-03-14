import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { UsagePanel } from '../UsagePanel';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;
});

describe('UsagePanel', () => {
  it('renders provider gauges with percentage remaining', async () => {
    const now = Date.now();
    const usageData = {
      summary: { costUsd: 1.234, inputTokens: 1200, outputTokens: 600, requests: 4 },
      providers: [
        { agentId: 'claude-code', label: 'Claude Code', costUsd: 1.234, inputTokens: 1200, outputTokens: 600, requests: 3, lastUsedAt: now, shareOfRequests: 0.75, reportedCostAvailable: true },
        { agentId: 'codex', label: 'Codex', costUsd: 0, inputTokens: 300, outputTokens: 120, requests: 1, lastUsedAt: now, shareOfRequests: 0.25, reportedCostAvailable: false },
      ],
      daily: [],
      windowDays: 7,
      updatedAt: now,
    };

    const liveUsage = {
      providers: [
        {
          providerId: 'claude-code',
          label: 'Claude Code',
          status: 'connected',
          fetchedAt: now,
          source: 'live',
          message: null,
          windows: [
            { providerId: 'claude-code', providerLabel: 'Claude Code', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed_warning', usedPercent: 0.82, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now, source: 'live', isStale: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
            { providerId: 'claude-code', providerLabel: 'Claude Code', windowKey: 'seven_day', windowLabel: '7d', status: 'allowed', usedPercent: 0.42, resetsAt: now + 86_400_000, remainingMs: 86_400_000, fetchedAt: now, source: 'live', isStale: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
          ],
        },
        {
          providerId: 'codex',
          label: 'Codex',
          status: 'connected',
          fetchedAt: now,
          source: 'live',
          message: null,
          windows: [
            { providerId: 'codex', providerLabel: 'Codex', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed', usedPercent: 0.33, resetsAt: now + 120_000, remainingMs: 120_000, fetchedAt: now, source: 'live', isStale: false, usedValue: 33, limitValue: 100, remainingValue: 67, unit: 'percent' },
            { providerId: 'codex', providerLabel: 'Codex', windowKey: 'seven_day', windowLabel: '7d', status: 'allowed_warning', usedPercent: 0.88, resetsAt: now + 172_800_000, remainingMs: 172_800_000, fetchedAt: now, source: 'live', isStale: false, usedValue: 88, limitValue: 100, remainingValue: 12, unit: 'percent' },
          ],
        },
      ],
      history: [],
      updatedAt: now,
    };

    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') return usageData;
      if (channel === 'usage:live') return liveUsage;
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('18%')).not.toBeNull();
    });

    // Remaining percentages: 100 - 82 = 18, 100 - 42 = 58, 100 - 33 = 67, 100 - 88 = 12
    expect(screen.getByText('58%')).not.toBeNull();
    expect(screen.getByText('67%')).not.toBeNull();
    expect(screen.getByText('12%')).not.toBeNull();

    // Provider names
    expect(screen.getByText('Claude Code')).not.toBeNull();
    expect(screen.getByText('Codex')).not.toBeNull();

    // Window labels
    expect(screen.getAllByText('5h').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7d').length).toBeGreaterThan(0);

    // Local summary
    expect(screen.getByText(/4 reqs/)).not.toBeNull();
  });

  it('handles provider errors gracefully', async () => {
    const now = Date.now();

    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') {
        return {
          summary: { costUsd: 0, inputTokens: 100, outputTokens: 20, requests: 1 },
          providers: [
            { agentId: 'claude-code', label: 'Claude Code', costUsd: 0, inputTokens: 100, outputTokens: 20, requests: 1, lastUsedAt: now, shareOfRequests: 1, reportedCostAvailable: false },
          ],
          daily: [],
          windowDays: 7,
          updatedAt: now,
        };
      }
      if (channel === 'usage:live') {
        return {
          providers: [
            { providerId: 'claude-code', label: 'Claude Code', status: 'error', fetchedAt: null, source: null, message: 'Claude usage request failed (401)', windows: [] },
            { providerId: 'codex', label: 'Codex', status: 'auth_missing', fetchedAt: null, source: null, message: 'Missing Codex credentials', windows: [] },
          ],
          history: [],
          updatedAt: now,
        };
      }
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('Not connected')).not.toBeNull();
    });

    expect(screen.getByText('Unavailable')).not.toBeNull();

    // Raw error messages should NOT be visible in text
    expect(screen.queryByText('Claude usage request failed (401)')).toBeNull();
    expect(screen.queryByText('Missing Codex credentials')).toBeNull();

    // Local summary still renders
    expect(screen.getByText(/1 reqs/)).not.toBeNull();
  });

  it('renders trend chart badges and sparse-data state', async () => {
    const now = Date.now();
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') {
        return {
          summary: { costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
          providers: [],
          daily: [],
          windowDays: 7,
          updatedAt: now,
        };
      }
      if (channel === 'usage:live') {
        return {
          providers: [
            {
              providerId: 'claude-code',
              label: 'Claude Code',
              status: 'connected',
              fetchedAt: now - (10 * 60_000),
              source: 'snapshot',
              message: 'Showing last known usage',
              windows: [
                { providerId: 'claude-code', providerLabel: 'Claude Code', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed', usedPercent: 0.45, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now - (10 * 60_000), source: 'snapshot', isStale: true, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
              ],
            },
          ],
          history: [
            { providerId: 'claude-code', windowKey: 'five_hour', sampledAt: now - 60_000, usedPercent: 0.45, resetsAt: now + 60_000, source: 'snapshot' },
          ],
          updatedAt: now,
        };
      }
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('Usage trend')).not.toBeNull();
    });

    expect(screen.getByText('snapshot')).not.toBeNull();
    expect(screen.getByText('stale 10m')).not.toBeNull();
    expect(screen.getAllByText('collecting points...').length).toBeGreaterThan(0);
  });

  it('renders timestamp-bucketed trend strip range labels', async () => {
    const now = Date.now();
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') {
        return {
          summary: { costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
          providers: [],
          daily: [],
          windowDays: 7,
          updatedAt: now,
        };
      }
      if (channel === 'usage:live') {
        return {
          providers: [
            {
              providerId: 'codex',
              label: 'Codex',
              status: 'connected',
              fetchedAt: now,
              source: 'live',
              message: null,
              windows: [
                { providerId: 'codex', providerLabel: 'Codex', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed', usedPercent: 0.33, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now, source: 'live', isStale: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
              ],
            },
          ],
          history: [
            { providerId: 'codex', windowKey: 'five_hour', sampledAt: now - (4 * 60_000), usedPercent: 0.2, resetsAt: null, source: 'live' },
            { providerId: 'codex', windowKey: 'five_hour', sampledAt: now - (2 * 60_000), usedPercent: 0.35, resetsAt: null, source: 'live' },
            { providerId: 'codex', windowKey: 'seven_day', sampledAt: now - (8 * 60 * 60_000), usedPercent: 0.5, resetsAt: null, source: 'live' },
            { providerId: 'codex', windowKey: 'seven_day', sampledAt: now - (2 * 60 * 60_000), usedPercent: 0.55, resetsAt: null, source: 'live' },
          ],
          updatedAt: now,
        };
      }
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('last 5h')).not.toBeNull();
    });

    expect(screen.getAllByText('last 7d').length).toBeGreaterThan(0);
  });

  it('shows empty state when no data', async () => {
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') {
        return { summary: { costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 }, providers: [], daily: [], windowDays: 7, updatedAt: Date.now() };
      }
      if (channel === 'usage:live') {
        return { providers: [], history: [], updatedAt: Date.now() };
      }
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('No usage data yet')).not.toBeNull();
    });
  });
});
