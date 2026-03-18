import { type MouseEvent as ReactMouseEvent, useEffect, useId, useMemo, useState } from 'react';
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

const CHART_WIDTH = 260;
const CHART_HEIGHT = 78;
const CHART_BASELINE_Y = 66;
const CHART_VALUE_HEIGHT = 54;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
const FIVE_HOUR_BUCKET_MS = 5 * 60 * 1000;
const SEVEN_DAY_BUCKET_MS = 2 * 60 * 60 * 1000;

type ProviderUsageHistory = { five_hour: UsageHistoryPoint[]; seven_day: UsageHistoryPoint[] };

interface TrendPoint {
  x: number;
  y: number;
  sampledAt: number;
  usedPercent: number;
  source: UsageHistoryPoint['source'];
}

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
    // Poll periodically so the panel recovers from transient API errors (429, 5xx).
    const pollInterval = setInterval(() => void loadUsage(true), 90_000);
    const cleanupLiveUpdate = window.api.on('usage:live-update', (data: unknown) => {
      setLiveUsage(data as LiveUsageOverview);
    });
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
      clearInterval(pollInterval);
      cleanupLiveUpdate();
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
  const barWidth = usedPct === 0 ? 0 : Math.max(6, usedPct);
  const staleTag = w.isExpired ? ' · reset' : w.isStale ? ' · stale' : '';

  return (
    <div className={`rounded-lg border border-border-subtle bg-bg-primary/55 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.04)] ${w.isStale ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-secondary font-medium">{w.windowLabel}</span>
        <span className="text-sm font-semibold text-text-primary tabular-nums">{usedPct}%</span>
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
        <span>{remainingPct}% remaining{staleTag}</span>
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
  history: ProviderUsageHistory;
}) {
  const color = PROVIDER_COLORS[provider.providerId];
  const hasWindows = provider.windows.length > 0;
  const isDisconnected = provider.status === 'auth_missing';
  const isError = provider.status === 'error';
  const hasHistory = history.five_hour.length > 0 || history.seven_day.length > 0;

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

      {/* Error with windows — live fetch broken but showing stale data */}
      {isError && hasWindows && provider.message && (
        <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-md bg-warning/10 text-text-secondary">
          <AlertCircle size={12} className="shrink-0 text-warning" />
          <span className="text-[10px] leading-tight">{provider.message}</span>
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
  history: ProviderUsageHistory;
}) {
  const fiveHourSeries = useMemo(
    () => buildWindowSeries(history.five_hour, FIVE_HOUR_MS, FIVE_HOUR_BUCKET_MS),
    [history.five_hour],
  );
  const sevenDaySeries = useMemo(
    () => buildWindowSeries(history.seven_day, SEVEN_DAY_MS, SEVEN_DAY_BUCKET_MS),
    [history.seven_day],
  );

  if (fiveHourSeries.length === 0 && sevenDaySeries.length === 0) {
    return null;
  }

  const staleAgeMs = provider.fetchedAt ? Math.max(0, Date.now() - provider.fetchedAt) : null;
  const isStale = provider.source !== 'live' || provider.windows.some((window) => window.isStale);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[10px] text-text-tertiary">
        <span>Usage trend</span>
        <div className="flex items-center gap-1.5">
          <TrendBadge label={formatSourceLabel(provider.source)} />
          {isStale && staleAgeMs !== null && <TrendBadge label={`stale ${formatAge(staleAgeMs)}`} />}
        </div>
      </div>
      <div className="space-y-2">
        <TrendStrip
          label="5h"
          points={fiveHourSeries}
          bucketMs={FIVE_HOUR_BUCKET_MS}
          windowMs={FIVE_HOUR_MS}
          strokeColor={STATUS_COLORS.allowed}
          areaColor={STATUS_COLORS.allowed}
        />
        <TrendStrip
          label="7d"
          points={sevenDaySeries}
          bucketMs={SEVEN_DAY_BUCKET_MS}
          windowMs={SEVEN_DAY_MS}
          strokeColor={PROVIDER_COLORS[provider.providerId]}
          areaColor={PROVIDER_COLORS[provider.providerId]}
        />
      </div>
    </div>
  );
}

function TrendStrip({
  label,
  points,
  bucketMs,
  windowMs,
  strokeColor,
  areaColor,
}: {
  label: string;
  points: TrendPoint[];
  bucketMs: number;
  windowMs: number;
  strokeColor: string;
  areaColor?: string;
}) {
  const [hovered, setHovered] = useState<TrendPoint | null>(null);
  const hasEnoughPoints = points.length > 1;
  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const segments = useMemo(
    () => splitSegmentsByGap(points, bucketMs * 2.5),
    [points, bucketMs],
  );
  const usesLiveData = points.some((point) => point.source === 'live');
  const lineDash = usesLiveData ? undefined : '3 3';
  const colorSeed = useId().replace(/:/g, '');
  const areaGradientId = `usage-trend-area-${label}-${colorSeed}`;
  const lineGradientId = `usage-trend-line-${label}-${colorSeed}`;
  const trendColor = areaColor ?? strokeColor;

  return (
    <div className="rounded-lg border border-border/65 bg-bg-primary/60 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.03)]">
      <div className="mb-1 flex items-center justify-between text-[10px] text-text-tertiary">
        <span className="font-semibold text-text-secondary">{label}</span>
        <span className="tabular-nums text-text-secondary">
          {latestPoint ? formatPercent(latestPoint.usedPercent) : '--'}
        </span>
      </div>

      {!hasEnoughPoints && (
        <div className="py-1 text-[10px] text-text-tertiary">
          collecting points...
        </div>
      )}

      {hasEnoughPoints && (
        <div className="relative h-16">
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="h-full w-full"
            onMouseLeave={() => setHovered(null)}
            onMouseMove={(event) => {
              const next = findNearestTrendPoint(event, points);
              setHovered(next);
            }}
          >
            <defs>
              <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trendColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={trendColor} stopOpacity="0.03" />
              </linearGradient>
              <linearGradient id={lineGradientId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.7" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="1" />
              </linearGradient>
            </defs>
            <line x1="0" y1={CHART_BASELINE_Y} x2={CHART_WIDTH} y2={CHART_BASELINE_Y} stroke="var(--color-border-subtle)" strokeWidth="1" />
            <line x1="0" y1={36} x2={CHART_WIDTH} y2={36} stroke="var(--color-border-subtle)" strokeOpacity="0.55" strokeWidth="1" />
            <line x1="0" y1={12} x2={CHART_WIDTH} y2={12} stroke="var(--color-border-subtle)" strokeOpacity="0.4" strokeWidth="1" />

            {areaColor && segments.map((segment, index) => (
              <path
                key={`${label}-area-${index}`}
                d={buildAreaPath(segment)}
                fill={`url(#${areaGradientId})`}
              />
            ))}

            {segments.map((segment, index) => (
              <path
                key={`${label}-line-${index}`}
                d={buildLinePath(segment)}
                fill="none"
                stroke={`url(#${lineGradientId})`}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={lineDash}
              />
            ))}

            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  y1={12}
                  x2={hovered.x}
                  y2={CHART_BASELINE_Y}
                  stroke="var(--color-text-tertiary)"
                  strokeOpacity="0.4"
                  strokeWidth="1"
                />
                <circle cx={hovered.x} cy={hovered.y} r="4.2" fill={strokeColor} fillOpacity="0.24" />
                <circle cx={hovered.x} cy={hovered.y} r="2.8" fill={strokeColor} />
              </>
            )}

            {latestPoint && !hovered && (
              <circle cx={latestPoint.x} cy={latestPoint.y} r="2.8" fill={strokeColor} />
            )}
          </svg>
          <div className="pointer-events-none absolute right-0 top-0 flex h-full flex-col justify-between py-0.5 text-[8px] text-text-tertiary/85">
            <span>100%</span>
            <span>50%</span>
            <span>0%</span>
          </div>
        </div>
      )}

      <div className="mt-1 flex items-center justify-between text-[10px] text-text-tertiary tabular-nums">
        {hovered ? (
          <>
            <span>{formatHoverTimestamp(hovered.sampledAt)} · {formatPercent(hovered.usedPercent)}</span>
            <span>{formatSourceLabel(hovered.source)}</span>
          </>
        ) : (
          <>
            <span>{formatWindowRange(windowMs)}</span>
            <span>{points.length} pts</span>
          </>
        )}
      </div>
    </div>
  );
}

function TrendBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border-subtle bg-bg-primary/55 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
      {label}
    </span>
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

function groupHistoryByProvider(history: UsageHistoryPoint[]): Map<'claude-code' | 'codex', ProviderUsageHistory> {
  const grouped = new Map<'claude-code' | 'codex', ProviderUsageHistory>();
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

function buildWindowSeries(series: UsageHistoryPoint[], windowMs: number, bucketMs: number): TrendPoint[] {
  if (series.length === 0) {
    return [];
  }

  const latestTimestamp = series[series.length - 1]?.sampledAt ?? Date.now();
  const endAt = Math.max(Date.now(), latestTimestamp);
  const startAt = endAt - windowMs;
  const buckets = new Map<number, {
    sum: number;
    count: number;
    sampledAt: number;
    source: UsageHistoryPoint['source'];
  }>();

  for (const point of series) {
    if (point.sampledAt < startAt || point.sampledAt > endAt) {
      continue;
    }
    const index = Math.floor((point.sampledAt - startAt) / bucketMs);
    const existing = buckets.get(index);
    if (existing) {
      existing.sum += clampPercent(point.usedPercent);
      existing.count += 1;
      if (point.sampledAt >= existing.sampledAt) {
        existing.sampledAt = point.sampledAt;
        existing.source = point.source;
      }
      continue;
    }
    buckets.set(index, {
      sum: clampPercent(point.usedPercent),
      count: 1,
      sampledAt: point.sampledAt,
      source: point.source,
    });
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, bucket]) => {
      const midpoint = startAt + (index * bucketMs) + (bucketMs / 2);
      const usedPercent = bucket.sum / bucket.count;
      return {
        x: clampNumber(((midpoint - startAt) / windowMs) * CHART_WIDTH, 0, CHART_WIDTH),
        y: CHART_BASELINE_Y - (usedPercent * CHART_VALUE_HEIGHT),
        sampledAt: bucket.sampledAt,
        usedPercent,
        source: bucket.source,
      };
    });
}

function splitSegmentsByGap(points: TrendPoint[], maxGapMs: number): TrendPoint[][] {
  if (points.length === 0) {
    return [];
  }

  const segments: TrendPoint[][] = [[points[0]]];
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const previous = points[i - 1];
    if (!point || !previous) continue;

    if (point.sampledAt - previous.sampledAt > maxGapMs) {
      segments.push([point]);
    } else {
      segments[segments.length - 1]?.push(point);
    }
  }

  return segments.filter((segment) => segment.length > 0);
}

function findNearestTrendPoint(event: ReactMouseEvent<SVGSVGElement>, points: TrendPoint[]): TrendPoint | null {
  if (points.length === 0) {
    return null;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return null;
  }

  const ratio = CHART_WIDTH / rect.width;
  const x = (event.clientX - rect.left) * ratio;
  let nearest = points[0];
  let minDistance = Infinity;

  for (const point of points) {
    const distance = Math.abs(point.x - x);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

function buildLinePath(points: TrendPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  const rest = points.slice(1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${rest}`;
}

function buildAreaPath(points: TrendPoint[]): string {
  if (points.length === 0) return '';
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${CHART_BASELINE_Y} L ${first.x.toFixed(2)} ${CHART_BASELINE_Y} Z`;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatWindowRange(windowMs: number): string {
  if (windowMs === FIVE_HOUR_MS) {
    return 'last 5h';
  }
  return 'last 7d';
}

function formatSourceLabel(source: LiveUsageProvider['source'] | UsageHistoryPoint['source'] | null): string {
  if (source === 'live') return 'live';
  if (source === 'snapshot') return 'snapshot';
  if (source === 'stream_fallback') return 'fallback';
  return 'unknown';
}

function formatHoverTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) {
    return time;
  }
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function clampPercent(value: number): number {
  return clampNumber(value, 0, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
