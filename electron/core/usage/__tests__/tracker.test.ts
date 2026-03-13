import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('UsageTracker', () => {
  it('aggregates totals and provider breakdown from stored result rows', async () => {
    const sampleDate = new Date();
    sampleDate.setHours(0, 0, 0, 0);
    sampleDate.setDate(sampleDate.getDate() - 1);
    const usageDate = [
      sampleDate.getFullYear(),
      String(sampleDate.getMonth() + 1).padStart(2, '0'),
      String(sampleDate.getDate()).padStart(2, '0'),
    ].join('-');

    const dailyRows = [
      {
        usage_date: usageDate,
        cost_usd: 1.25,
        input_tokens: 1500,
        output_tokens: 575,
        requests: 2,
      },
    ];
    const providerRows = [
      {
        agent_id: 'claude-code',
        cost_usd: 1.25,
        input_tokens: 1200,
        output_tokens: 450,
        requests: 1,
        last_used_at: Date.now(),
        priced_requests: 1,
      },
      {
        agent_id: 'openai',
        cost_usd: 0,
        input_tokens: 300,
        output_tokens: 125,
        requests: 1,
        last_used_at: Date.now(),
        priced_requests: 0,
      },
    ];
    const summaryRow = {
      cost_usd: 1.25,
      input_tokens: 1500,
      output_tokens: 575,
      requests: 2,
    };

    vi.doMock('../../db/connection', () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          all: () => {
            if (sql.includes('GROUP BY usage_date')) return dailyRows;
            if (sql.includes('GROUP BY s.agent_id')) return providerRows;
            return [];
          },
          get: () => summaryRow,
        }),
      }),
    }));

    const { UsageTracker } = await import('../tracker');
    const usage = new UsageTracker().get(7);

    expect(usage.summary.requests).toBe(2);
    expect(usage.summary.costUsd).toBeCloseTo(1.25);
    expect(usage.summary.inputTokens).toBe(1500);
    expect(usage.summary.outputTokens).toBe(575);
    expect(usage.providers).toHaveLength(2);

    const claude = usage.providers.find((provider) => provider.agentId === 'claude-code');
    const openai = usage.providers.find((provider) => provider.agentId === 'openai');

    expect(claude?.reportedCostAvailable).toBe(true);
    expect(claude?.costUsd).toBeCloseTo(1.25);
    expect(openai?.reportedCostAvailable).toBe(false);
    expect(openai?.inputTokens).toBe(300);
    expect(usage.daily).toHaveLength(7);
    expect(usage.daily.some((day) => day.requests > 0)).toBe(true);
  });
});
