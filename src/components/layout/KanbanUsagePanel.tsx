import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gauge, RefreshCw, X } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useChatStore } from '../../stores/chat';
import type { LiveUsageOverview, RateLimitInfo } from '../../lib/ipc-api';
import {
  computeHighestSeverity,
  formatTimeUntil,
  mergeRateLimits,
  normalizeTaskRateLimit,
  providerLabel,
  resolveRateLimitProvider,
} from '../../lib/rate-limits';
import { formatRelativeTime } from '../../lib/format';

export function KanbanUsagePanel() {
  const open = useUiStore((s) => s.kanbanUsagePanelOpen);
  const liveOverview = useUiStore((s) => s.liveOverview);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });

  const activeTaskRateLimit = useMemo(
    () => normalizeTaskRateLimit(activeTask?.rateLimitInfo, activeTask?.agentId),
    [activeTask?.rateLimitInfo, activeTask?.agentId],
  );

  const liveRateLimits = useMemo(
    () =>
      (liveOverview?.providers ?? []).flatMap((p) =>
        p.windows.map(
          (w) =>
            ({
              providerId: w.providerId,
              status: w.status,
              resetsAt: w.resetsAt ?? 0,
              rateLimitType: w.windowLabel,
              utilization: w.usedPercent,
              fetchedAt: w.fetchedAt,
            }) satisfies RateLimitInfo,
        ),
      ),
    [liveOverview],
  );

  const allRateLimits = useMemo(
    () => mergeRateLimits(liveRateLimits, activeTaskRateLimit),
    [liveRateLimits, activeTaskRateLimit],
  );

  const activeProvider = useMemo(
    () => resolveRateLimitProvider(activeTask?.agentId ?? selectedAgentId),
    [activeTask?.agentId, selectedAgentId],
  );

  const scopedRateLimits = useMemo(
    () =>
      activeProvider
        ? allRateLimits.filter((e) => e.providerId === activeProvider)
        : allRateLimits,
    [allRateLimits, activeProvider],
  );

  const highestSeverity = useMemo(
    () => computeHighestSeverity(scopedRateLimits),
    [scopedRateLimits],
  );

  // Tick every 30s for countdown freshness
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [open]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = (await window.api.invoke('usage:live')) as LiveUsageOverview;
      useUiStore.getState().setLiveOverview(result);
    } catch {
      // keep previous state
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refresh on open
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="overflow-hidden border-b border-border bg-bg-secondary"
        >
          <div className="px-4 py-3">
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge size={14} className="text-text-tertiary" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Rate Limits
                </p>
                {activeProvider && (
                  <span className="text-[10px] text-text-tertiary">
                    — {providerLabel(activeProvider)}
                  </span>
                )}
                {highestSeverity && (
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      highestSeverity === 'rejected'
                        ? 'bg-red-400'
                        : highestSeverity === 'allowed_warning'
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                  />
                )}
              </div>
              <div className="flex items-center gap-1">
                {liveOverview?.updatedAt && (
                  <span className="text-[10px] text-text-tertiary">
                    {formatRelativeTime(liveOverview.updatedAt)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Refresh"
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => useUiStore.getState().setKanbanUsagePanelOpen(false)}
                  className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Close"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Rate limit cards */}
            {scopedRateLimits.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-text-tertiary">
                No rate limit data yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {scopedRateLimits.map((entry) => (
                  <RateLimitCard
                    key={`${entry.providerId}:${entry.rateLimitType}`}
                    entry={entry}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RateLimitCard({ entry }: { entry: RateLimitInfo }) {
  const usedPercent = Math.round(Math.max(0, Math.min(1, entry.utilization)) * 100);
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const barWidth = usedPercent === 0 ? 0 : Math.max(4, usedPercent);
  const meta = statusMeta(entry.status);

  return (
    <div className="min-w-[180px] flex-1 max-w-[280px] rounded-lg border border-border/55 bg-bg-primary/65 px-3 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.05)]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium text-text-primary">
          {entry.rateLimitType.replace(/[_-]+/g, ' ')}
        </p>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${meta.badgeClass}`}
        >
          {meta.label}
        </span>
      </div>
      <div className="mt-1.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold tabular-nums text-text-primary">
            {usedPercent}%
          </span>
          <span className="text-[10px] tabular-nums text-text-tertiary">
            {remainingPercent}% remaining
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border/30">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${barWidth}%`,
              background: `linear-gradient(90deg, ${meta.ringColor}, color-mix(in oklab, ${meta.ringColor} 80%, white))`,
            }}
          />
        </div>
        <div className="mt-1 text-right text-[10px] text-text-tertiary">
          {entry.resetsAt > 0 ? `resets ${formatTimeUntil(entry.resetsAt)}` : 'no reset'}
        </div>
      </div>
    </div>
  );
}

function statusMeta(status: RateLimitInfo['status']) {
  if (status === 'rejected') {
    return {
      label: 'Limited',
      badgeClass: 'border-error/30 bg-error/10 text-error',
      ringColor: 'var(--color-error)',
    };
  }
  if (status === 'allowed_warning') {
    return {
      label: 'Warning',
      badgeClass: 'border-warning/35 bg-warning/12 text-warning',
      ringColor: 'var(--color-warning)',
    };
  }
  return {
    label: 'Healthy',
    badgeClass: 'border-success/30 bg-success/10 text-success',
    ringColor: 'var(--color-success)',
  };
}
