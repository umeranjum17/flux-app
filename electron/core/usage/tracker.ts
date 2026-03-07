import { getDb } from '../db/connection';

export interface UsageTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface DailyAggregate extends UsageTotals {
  date: string;
}

export interface ProviderUsage extends UsageTotals {
  agentId: string;
  label: string;
  lastUsedAt: number | null;
  shareOfRequests: number;
  reportedCostAvailable: boolean;
}

export interface UsageInfo {
  summary: UsageTotals;
  providers: ProviderUsage[];
  daily: DailyAggregate[];
  windowDays: number;
  updatedAt: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama',
};

export class UsageTracker {
  get(windowDays: number = 14): UsageInfo {
    const db = getDb();
    const dailyRows = db
      .prepare(
        `SELECT
          date(m.timestamp / 1000, 'unixepoch', 'localtime') AS usage_date,
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
          COUNT(*) AS requests
        FROM messages m
        INNER JOIN sessions s ON s.id = m.session_id
        WHERE m.type = 'result'
          AND m.timestamp >= ?
        GROUP BY usage_date
        ORDER BY usage_date ASC`
      )
      .all(this.startOfWindow(windowDays)) as Array<{
        usage_date: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        requests: number;
      }>;

    const providerRows = db
      .prepare(
        `SELECT
          s.agent_id AS agent_id,
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
          COUNT(*) AS requests,
          MAX(m.timestamp) AS last_used_at,
          SUM(CASE WHEN m.cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS priced_requests
        FROM messages m
        INNER JOIN sessions s ON s.id = m.session_id
        WHERE m.type = 'result'
        GROUP BY s.agent_id`
      )
      .all() as Array<{
        agent_id: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        requests: number;
        last_used_at: number | null;
        priced_requests: number;
      }>;

    const summaryRow = db
      .prepare(
        `SELECT
          COALESCE(SUM(m.cost_usd), 0) AS cost_usd,
          COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
          COUNT(*) AS requests
        FROM messages m
        INNER JOIN sessions s ON s.id = m.session_id
        WHERE m.type = 'result'`
      )
      .get() as {
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
        requests: number;
      };

    const summary: UsageTotals = {
      costUsd: summaryRow.cost_usd,
      inputTokens: summaryRow.input_tokens,
      outputTokens: summaryRow.output_tokens,
      requests: summaryRow.requests,
    };

    const providers = providerRows
      .map((row) => ({
        agentId: row.agent_id,
        label: PROVIDER_LABELS[row.agent_id] ?? row.agent_id,
        costUsd: row.cost_usd,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        requests: row.requests,
        lastUsedAt: row.last_used_at,
        reportedCostAvailable: row.priced_requests > 0,
        shareOfRequests: summary.requests > 0 ? row.requests / summary.requests : 0,
      }))
      .sort((a, b) => {
        if (b.requests !== a.requests) return b.requests - a.requests;
        if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd;
        return b.outputTokens - a.outputTokens;
      });

    return {
      summary,
      providers,
      daily: this.fillWindow(dailyRows, windowDays),
      windowDays,
      updatedAt: Date.now(),
    };
  }

  private fillWindow(
    rows: Array<{
      usage_date: string;
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      requests: number;
    }>,
    windowDays: number,
  ): DailyAggregate[] {
    const rowMap = new Map(rows.map((row) => [row.usage_date, row]));
    const filled: DailyAggregate[] = [];

    for (let offset = windowDays - 1; offset >= 0; offset--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = this.toLocalDateKey(date);
      const row = rowMap.get(key);

      filled.push({
        date: key,
        costUsd: row?.cost_usd ?? 0,
        inputTokens: row?.input_tokens ?? 0,
        outputTokens: row?.output_tokens ?? 0,
        requests: row?.requests ?? 0,
      });
    }

    return filled;
  }

  private startOfWindow(windowDays: number): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (windowDays - 1));
    return start.getTime();
  }

  private toLocalDateKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
