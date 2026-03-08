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
  it('renders provider totals and marks missing cost data clearly', async () => {
    const usageData = {
      summary: {
        costUsd: 1.234,
        inputTokens: 1200,
        outputTokens: 600,
        requests: 4,
      },
      providers: [
        {
          agentId: 'claude-code',
          label: 'Claude Code',
          costUsd: 1.234,
          inputTokens: 1200,
          outputTokens: 600,
          requests: 3,
          lastUsedAt: Date.now(),
          shareOfRequests: 0.75,
          reportedCostAvailable: true,
        },
        {
          agentId: 'openai',
          label: 'OpenAI',
          costUsd: 0,
          inputTokens: 300,
          outputTokens: 120,
          requests: 1,
          lastUsedAt: Date.now(),
          shareOfRequests: 0.25,
          reportedCostAvailable: false,
        },
      ],
      daily: [
        { date: '2026-03-01', costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
        { date: '2026-03-02', costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
        { date: '2026-03-03', costUsd: 0.123, inputTokens: 100, outputTokens: 50, requests: 1 },
        { date: '2026-03-04', costUsd: 0.456, inputTokens: 300, outputTokens: 150, requests: 1 },
        { date: '2026-03-05', costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
        { date: '2026-03-06', costUsd: 0.655, inputTokens: 500, outputTokens: 250, requests: 2 },
        { date: '2026-03-07', costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
      ],
      windowDays: 7,
      updatedAt: Date.now(),
    };

    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:get') return usageData;
      if (channel === 'usage:rate-limits') return null;
      return null;
    });

    render(<UsagePanel />);

    await waitFor(() => {
      expect(screen.getByText('Claude Code')).not.toBeNull();
    });

    expect(screen.getByText('OpenAI')).not.toBeNull();
    expect(screen.getByText('Unavailable')).not.toBeNull();
    expect(screen.getAllByText('$1.234')).toHaveLength(2);
  });
});
