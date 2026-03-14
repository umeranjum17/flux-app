import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, WifiOff } from 'lucide-react';
import type { LiveUsageOverview, LiveUsageProvider, LiveUsageWindow, UsageHistoryPoint, UsageInfo } from '../../lib/ipc-api';

const PROVIDER_COLORS: Record<'claude-code' | 'codex', string> = {
  'claude-code': 'var(--color-info)',
  codex: 'var(--color-accent)',
};

const STATUS_COLORS: Record<LiveUsageWindow['status'], string> = {
  allowed: 'var(--color-success)',
  allowed_warning: 'var(--color-warning)',
  rejected: 'var(--color-error)',
};

export function UsagePanel() {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveUsageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadUsage(background = false): Promise<void> {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [usageResult, liveResult] = await Promise.all([
        window.api.invoke('usage:get') as Promise<UsageInfo>,
        window.api.invoke('usage:live') as Promise<LiveUsageOverview>,
      ]);
      setUsage(usageResult);
      setLiveUsage(liveResult);
    } catch {
      setUsage(null);
      setLiveUsage(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadUsage();
    const interval = setInterval(() => {
      void loadUsage(true);
    }, 60_000);
    const cleanupDone = window.api.on('agent:done', () => {
      void loadUsage(true);
    });
    const cleanupMessage = window.api.on('agent:message', (...args: unknown[]) => {
      const data = args[0] as { message?: { type?: string } } | undefined;
      if (data?.message?.type === 'rate_limit') {
        void loadUsage(true);
      }
    });
    return () => {
      clearInterval(interval);
      cleanupDone();
      cleanupMessage();
    };
  }, []);

  const providers = useMemo(() => liveUsage?.providers ?? [], [liveUsage]);
  const historyByProvider = useMemo(() => groupHistoryByProvider(liveUsage?.history ?? []), [liveUsage?.history]);

  if (loading && !usage && !liveUsage) {
    return (
      <div className="flex flex-col flex-1 min-h-0 px-3 pt-3">
        <p className="text-[11px] text-text-tertiary text-center py-8">Loading usage...</p>
      </div>
    );
  }

  const hasLiveContent = providers.some((p) => p.windows.length > 0 || p.message);
  const hasLocalUsage = !!usage && usage.summary.requests > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 px-3 pt-3 pb-2 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Usage</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            Updated {formatRelativeTime(liveUsage?.updatedAt ?? usage?.updatedAt ?? Date.now())}
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

      <div className="space-y-3">
        {/* Provider cards */}
        {providers.map((provider) => (
          <ProviderCard
            key={provider.providerId}
            provider={provider}
            history={historyByProvider.get(provider.providerId) ?? { five_hour: [], seven_day: [] }}
          />
        ))}

        {/* Local usage summary */}
        {hasLocalUsage && usage && <LocalUsageSummary usage={usage} />}

        {/* Empty state */}
        {!hasLiveContent && !hasLocalUsage && <EmptyState />}
      </div>
    </div>
  );
}

function UsageWindowBar({ window: w }: { window: LiveUsageWindow }) {
  const usedPct = Math.round(Math.max(0, Math.min(1, w.usedPercent)) * 100);
  const remainingPct = Math.max(0, 100 - usedPct);
  const barWidth = remainingPct === 0 ? 0 : Math.max(6, remainingPct);

  return (
    <div className={`rounded-lg border border-border-subtle bg-bg-primary/55 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.04)] ${w.isStale ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-secondary font-medium">{w.windowLabel}</span>
        <span className="text-sm font-semibold text-text-primary tabular-nums">{remainingPct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-hover/90">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${barWidth}%`,
            background: `linear-gradient(90deg, ${STATUS_COLORS[w.status]}, color-mix(in oklab, ${STATUS_COLORS[w.status]} 75%, white))`,
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
        <span>{usedPct}% used{w.isStale ? ' · stale' : ''}</span>
        {w.resetsAt ? <span>resets in {formatTimeUntil(w.resetsAt)}</span> : <span>no reset</span>}
      </div>
    </div>
  );
}

// --- Provider Card ---

function ProviderCard({
  provider,
  history,
}: {
  provider: LiveUsageProvider;
  history: { five_hour: UsageHistoryPoint[]; seven_day: UsageHistoryPoint[] };
}) {
  const color = PROVIDER_COLORS[provider.providerId];
  const hasWindows = provider.windows.length > 0;
  const isDisconnected = provider.status === 'auth_missing';
  const isError = provider.status === 'error';
  const hasHistory = history.five_hour.length > 1 || history.seven_day.length > 1;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/80 p-3 shadow-[0_6px_18px_hsl(0_0%_0%_/_0.2)]">
      {/* Provider header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm font-medium text-text-primary">{provider.label}</span>
        {provider.status === 'connected' && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success shrink-0" />
        )}
      </div>

      {/* Connected with windows */}
      {hasWindows && (
        <div className="space-y-2.5">
          {provider.windows.map((w) => (
            <UsageWindowBar key={`${w.providerId}-${w.windowKey}`} window={w} />
          ))}
        </div>
      )}

      {hasWindows && hasHistory && (
        <div className="mt-2.5 rounded-lg border border-border-subtle bg-bg-primary/45 px-2 py-2">
          <UsageTrendChart provider={provider} history={history} />
        </div>
      )}

      {/* Auth missing */}
      {isDisconnected && !hasWindows && (
        <div className="flex items-center gap-2 py-2 text-text-tertiary">
          <WifiOff size={14} />
          <span className="text-[11px]">Not connected</span>
        </div>
      )}

      {/* Error without windows */}
      {isError && !hasWindows && (
        <div className="flex items-center gap-2 py-2 text-text-tertiary">
          <span title={provider.message ?? undefined}><AlertCircle size={14} /></span>
          <span className="text-[11px]">Unavailable</span>
        </div>
      )}
    </div>
  );
}

function UsageTrendChart({
  provider,
  history,
}: {
  provider: LiveUsageProvider;
  history: { five_hour: UsageHistoryPoint[]; seven_day: UsageHistoryPoint[] };
}) {
  const fiveHourSeries = compactHistory(history.five_hour);
  const sevenDaySeries = compactHistory(history.seven_day);

  if (fiveHourSeries.length < 2 && sevenDaySeries.length < 2) {
    return null;
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-tertiary">
        <span>Usage trend</span>
        <span className="tabular-nums">{provider.source === 'snapshot' ? 'snapshot' : 'live'}</span>
      </div>
      <div className="h-20">
        <svg viewBox="0 0 260 72" className="h-full w-full">
          <defs>
            <linearGradient id={`${provider.providerId}-fill-5h`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STATUS_COLORS.allowed} stopOpacity="0.35" />
              <stop offset="100%" stopColor={STATUS_COLORS.allowed} stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`${provider.providerId}-fill-7d`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PROVIDER_COLORS[provider.providerId]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={PROVIDER_COLORS[provider.providerId]} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <line x1="0" y1="60" x2="260" y2="60" stroke="var(--color-border-subtle)" strokeWidth="1" />
          <line x1="0" y1="36" x2="260" y2="36" stroke="var(--color-border-subtle)" strokeOpacity="0.6" strokeWidth="1" />
          <line x1="0" y1="12" x2="260" y2="12" stroke="var(--color-border-subtle)" strokeOpacity="0.45" strokeWidth="1" />
          {fiveHourSeries.length > 1 && (
            <>
              <path d={buildAreaPath(fiveHourSeries)} fill={`url(#${provider.providerId}-fill-5h)`} />
              <path d={buildLinePath(fiveHourSeries)} fill="none" stroke={STATUS_COLORS.allowed} strokeWidth="2.2" strokeLinecap="round" />
            </>
          )}
          {sevenDaySeries.length > 1 && (
            <>
              <path d={buildAreaPath(sevenDaySeries)} fill={`url(#${provider.providerId}-fill-7d)`} />
              <path d={buildLinePath(sevenDaySeries)} fill="none" stroke={PROVIDER_COLORS[provider.providerId]} strokeWidth="1.8" strokeLinecap="round" />
            </>
          )}
        </svg>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-tertiary">
        <span className="tabular-nums">5h {formatPercent(latestUsedPercent(fiveHourSeries))}</span>
        <span className="tabular-nums">7d {formatPercent(latestUsedPercent(sevenDaySeries))}</span>
      </div>
    </div>
  );
}

// --- Local Usage Summary ---

function LocalUsageSummary({ usage }: { usage: UsageInfo }) {
  const { requests, inputTokens, outputTokens } = usage.summary;
  return (
    <div className="border-t border-border pt-2 mt-1">
      <p className="text-[10px] text-text-tertiary text-center">
        This session{'  '}·{'  '}{formatCount(requests)} reqs{'  '}·{'  '}{formatTokens(inputTokens + outputTokens)} tok
      </p>
    </div>
  );
}

// --- Empty State ---

function EmptyState() {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated px-4 py-5 text-center">
      <BarChart3 size={18} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-sm text-text-primary">No usage data yet</p>
      <p className="text-[11px] text-text-tertiary mt-1">Usage will appear after your first run.</p>
    </div>
  );
}

// --- Formatters ---

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatCount(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
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

function formatTimeUntil(timestamp: number): string {
  const diffMs = Math.max(0, timestamp - Date.now());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function groupHistoryByProvider(history: UsageHistoryPoint[]): Map<'claude-code' | 'codex', { five_hour: UsageHistoryPoint[]; seven_day: UsageHistoryPoint[] }> {
  const grouped = new Map<'claude-code' | 'codex', { five_hour: UsageHistoryPoint[]; seven_day: UsageHistoryPoint[] }>();
  grouped.set('claude-code', { five_hour: [], seven_day: [] });
  grouped.set('codex', { five_hour: [], seven_day: [] });

  for (const point of history) {
    const providerGroup = grouped.get(point.providerId);
    if (!providerGroup) continue;
    providerGroup[point.windowKey].push(point);
  }

  for (const providerGroup of grouped.values()) {
    providerGroup.five_hour.sort((left, right) => left.sampledAt - right.sampledAt);
    providerGroup.seven_day.sort((left, right) => left.sampledAt - right.sampledAt);
  }

  return grouped;
}

function compactHistory(series: UsageHistoryPoint[]): Array<{ x: number; y: number }> {
  if (series.length <= 40) {
    return series.map((point, index) => ({
      x: (index / Math.max(1, series.length - 1)) * 260,
      y: 60 - (Math.max(0, Math.min(1, point.usedPercent)) * 48),
    }));
  }

  const chunkSize = Math.ceil(series.length / 40);
  const compacted: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < series.length; i += chunkSize) {
    const chunk = series.slice(i, i + chunkSize);
    const avg = chunk.reduce((sum, point) => sum + Math.max(0, Math.min(1, point.usedPercent)), 0) / chunk.length;
    compacted.push({
      x: (compacted.length / Math.max(1, Math.ceil(series.length / chunkSize) - 1)) * 260,
      y: 60 - (avg * 48),
    });
  }
  return compacted;
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const first = points[0];
  const rest = points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest}`;
}

function buildAreaPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} 60 L ${first.x.toFixed(2)} 60 Z`;
}

function latestUsedPercent(points: Array<{ x: number; y: number }>): number | null {
  if (points.length === 0) {
    return null;
  }
  const last = points[points.length - 1];
  return (60 - last.y) / 48;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
