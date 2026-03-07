import { getDb } from '../db/connection';

export interface UsageInfo {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  rateLimits: {
    requestsRemaining: number | null;
    tokensRemaining: number | null;
    resetAt: string | null;
  };
}

export interface DailyAggregate {
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export class UsageTracker {
  async get(): Promise<UsageInfo> {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(requests), 0) as total_requests
        FROM usage_metrics`
      )
      .get() as any;

    const rateLimits = await this.pollRateLimits();

    return {
      totalCostUsd: row.total_cost,
      totalInputTokens: row.total_input,
      totalOutputTokens: row.total_output,
      totalRequests: row.total_requests,
      rateLimits,
    };
  }

  trackUsage(
    agentId: string,
    cost: number,
    inputTokens: number,
    outputTokens: number
  ): void {
    const db = getDb();
    const date = new Date().toISOString().slice(0, 10);

    const existing = db
      .prepare('SELECT id FROM usage_metrics WHERE agent_id = ? AND date = ?')
      .get(agentId, date) as any;

    if (existing) {
      db.prepare(
        `UPDATE usage_metrics
         SET cost_usd = cost_usd + ?,
             input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             requests = requests + 1
         WHERE id = ?`
      ).run(cost, inputTokens, outputTokens, existing.id);
    } else {
      db.prepare(
        `INSERT INTO usage_metrics (agent_id, date, cost_usd, input_tokens, output_tokens, requests)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(agentId, date, cost, inputTokens, outputTokens);
    }
  }

  getDailyAggregate(date: string): DailyAggregate {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
          COALESCE(SUM(cost_usd), 0) as cost_usd,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(requests), 0) as requests
        FROM usage_metrics
        WHERE date = ?`
      )
      .get(date) as any;

    return {
      date,
      costUsd: row.cost_usd,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      requests: row.requests,
    };
  }

  private async pollRateLimits(): Promise<UsageInfo['rateLimits']> {
    // Poll Claude API rate limits
    try {
      const resp = await fetch('https://api.anthropic.com/v1/rate_limits', {
        method: 'GET',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
      });

      if (resp.ok) {
        return {
          requestsRemaining: Number(resp.headers.get('x-ratelimit-remaining-requests')) || null,
          tokensRemaining: Number(resp.headers.get('x-ratelimit-remaining-tokens')) || null,
          resetAt: resp.headers.get('x-ratelimit-reset') || null,
        };
      }
    } catch {
      // Rate limit polling is best-effort
    }

    return {
      requestsRemaining: null,
      tokensRemaining: null,
      resetAt: null,
    };
  }
}
