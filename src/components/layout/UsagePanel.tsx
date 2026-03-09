import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, WifiOff } from 'lucide-react';
import type { LiveUsageOverview, LiveUsageProvider, LiveUsageWindow, UsageInfo } from '../../lib/ipc-api';

const PROVIDER_COLORS: Record<'claude-code' | 'codex', string> = {
  'claude-code': '#D97706',
  codex: '#10B981',
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
      cleanupDone();
      cleanupMessage();
    };
  }, []);

  const providers = useMemo(() => liveUsage?.providers ?? [], [liveUsage]);

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
          <ProviderCard key={provider.providerId} provider={provider} />
        ))}

        {/* Local usage summary */}
        {hasLocalUsage && usage && <LocalUsageSummary usage={usage} />}

        {/* Empty state */}
        {!hasLiveContent && !hasLocalUsage && <EmptyState />}
      </div>
    </div>
  );
}

// --- SVG Gauge ---

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 180) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function SemiCircleGauge({ remainingPct, status }: { remainingPct: number; status: LiveUsageWindow['status'] }) {
  const cx = 40;
  const cy = 44;
  const r = 32;
  const fillDeg = Math.max(0, Math.min(1, remainingPct / 100)) * 180;

  return (
    <svg viewBox="0 0 80 48" className="w-full max-w-[80px] mx-auto">
      <path
        d={describeArc(cx, cy, r, 0, 180)}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {fillDeg > 0.5 && (
        <path
          d={describeArc(cx, cy, r, 0, fillDeg)}
          fill="none"
          stroke={STATUS_COLORS[status]}
          strokeWidth="6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

// --- Window Gauge ---

function WindowGauge({ window: w }: { window: LiveUsageWindow }) {
  const remainingPct = Math.round((1 - w.usedPercent) * 100);

  return (
    <div className={`flex flex-col items-center gap-0.5 ${w.isStale ? 'opacity-60' : ''}`}>
      <SemiCircleGauge remainingPct={remainingPct} status={w.status} />
      <span className="text-lg font-bold text-text-primary leading-tight">{remainingPct}%</span>
      <span className="text-[10px] text-text-tertiary">
        {w.windowLabel}{w.isStale ? ' · stale' : ''}
      </span>
      {w.resetsAt && (
        <span className="text-[10px] text-text-tertiary">resets in {formatTimeUntil(w.resetsAt)}</span>
      )}
    </div>
  );
}

// --- Provider Card ---

function ProviderCard({ provider }: { provider: LiveUsageProvider }) {
  const color = PROVIDER_COLORS[provider.providerId];
  const hasWindows = provider.windows.length > 0;
  const isDisconnected = provider.status === 'auth_missing';
  const isError = provider.status === 'error';

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-3">
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
        <div className={`grid gap-3 ${provider.windows.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {provider.windows.map((w) => (
            <WindowGauge key={`${w.providerId}-${w.windowKey}`} window={w} />
          ))}
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
