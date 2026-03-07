import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import type { UsageInfo } from '../../lib/ipc-api';

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': '#D97706',
  codex: '#10B981',
  gemini: '#2563EB',
  openai: '#111827',
  ollama: '#6D28D9',
};

export function UsagePanel() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await window.api.invoke('usage:get') as UsageInfo;
      setUsage(result);
    } catch {
      setUsage(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
    const cleanup = window.api.on('agent:done', () => {
      void loadUsage(true);
    });
    return cleanup;
  }, [loadUsage]);

  if (loading && !usage) {
    return (
      <div className="flex flex-col flex-1 min-h-0 px-3 pt-3">
        <p className="text-[11px] text-text-tertiary text-center py-8">Loading usage...</p>
      </div>
    );
  }

  if (!usage || usage.summary.requests === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0 px-3 pt-3">
        <div className="rounded-xl border border-border bg-bg-elevated px-4 py-5 text-center">
          <BarChart3 size={18} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-sm text-text-primary">No usage yet</p>
          <p className="text-[11px] text-text-tertiary mt-1">
            Provider spend, requests, and token totals will appear after your first completed run.
          </p>
        </div>
      </div>
    );
  }

  const maxDailyRequests = Math.max(1, ...usage.daily.map((day) => day.requests));
  const hasReportedCost = usage.providers.some((provider) => provider.reportedCostAvailable);

  return (
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-3 pb-2 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Usage</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            Updated {formatRelativeTime(usage.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage(true)}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Refresh usage"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatCard label="Reported Spend" value={hasReportedCost ? formatUsd(usage.summary.costUsd) : 'Unavailable'} />
        <StatCard label="Requests" value={formatCount(usage.summary.requests)} />
        <StatCard label="Input Tokens" value={formatTokens(usage.summary.inputTokens)} />
        <StatCard label="Output Tokens" value={formatTokens(usage.summary.outputTokens)} />
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            Last {usage.windowDays} Days
          </span>
          <span className="text-[10px] text-text-tertiary">
            {usage.daily.reduce((sum, day) => sum + day.requests, 0)} requests
          </span>
        </div>
        <div className="flex items-end gap-1 h-20">
          {usage.daily.map((day) => {
            const height = Math.max(10, Math.round((day.requests / maxDailyRequests) * 100));
            const active = day.requests > 0;
            return (
              <div
                key={day.date}
                className={`flex-1 rounded-md transition-colors ${active ? 'bg-accent/70 hover:bg-accent' : 'bg-bg-primary'}`}
                style={{ height: `${height}%` }}
                title={`${formatDay(day.date)}: ${day.requests} req, ${formatUsd(day.costUsd)}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-text-tertiary">
          <span>{formatDay(usage.daily[0]?.date)}</span>
          <span>{formatDay(usage.daily[usage.daily.length - 1]?.date)}</span>
        </div>
      </div>

      <div className="space-y-2">
        {usage.providers.map((provider) => {
          const color = PROVIDER_COLORS[provider.agentId] ?? '#64748B';
          return (
            <div
              key={provider.agentId}
              className="rounded-xl border border-border bg-bg-elevated p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{provider.label}</p>
                    <p className="text-[10px] text-text-tertiary">
                      {provider.lastUsedAt ? `Last used ${formatRelativeTime(provider.lastUsedAt)}` : 'No recent runs'}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] text-text-tertiary shrink-0">
                  {Math.round(provider.shareOfRequests * 100)}% of requests
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3">
                <ProviderMetric
                  label="Spend"
                  value={provider.reportedCostAvailable ? formatUsd(provider.costUsd) : 'Unavailable'}
                />
                <ProviderMetric label="Requests" value={formatCount(provider.requests)} />
                <ProviderMetric
                  label="Tokens"
                  value={formatTokens(provider.inputTokens + provider.outputTokens)}
                />
              </div>

              <div className="mt-3 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(4, provider.shareOfRequests * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">{label}</p>
      <p className="text-sm font-medium text-text-primary mt-1">{value}</p>
    </div>
  );
}

function ProviderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-primary border border-border px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">{label}</p>
      <p className="text-xs text-text-primary mt-1">{value}</p>
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(3)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatCount(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatDay(dateString: string | undefined): string {
  if (!dateString) return '';
  return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
