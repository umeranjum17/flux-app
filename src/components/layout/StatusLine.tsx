import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { GitBranch, LoaderCircle, Gauge, RefreshCw } from 'lucide-react';
import type { LiveUsageOverview, RateLimitInfo } from '../../lib/ipc-api';
import { isWorkspaceArchiving } from '../../lib/workspace-operations';
import { formatRelativeTime } from '../../lib/format';
import {
  computeHighestSeverity,
  formatTimeUntil,
  mergeRateLimits,
  normalizeTaskRateLimit,
  providerLabel,
  rateLimitTextColor,
  resolveRateLimitProvider,
} from '../../lib/rate-limits';

export function StatusLine() {
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceOperation = useWorkspaceStore((s) => (activeWorkspaceId ? s.workspaceOperations.get(activeWorkspaceId) : undefined));
  const activeWorkspaceOperation = isWorkspaceArchiving(workspaceOperation) ? workspaceOperation : null;

  // Rate limits state
  const [showRateLimits, setShowRateLimits] = useState(false);
  const liveOverview = useUiStore((s) => s.liveOverview);

  const refreshLiveUsage = useCallback(async () => {
    try {
      const result = await window.api.invoke('usage:live') as LiveUsageOverview;
      useUiStore.getState().setLiveOverview(result);
    } catch {
      // keep previous state
    }
  }, []);

  useEffect(() => {
    // Only subscribe to the background poller broadcast — no mount-triggered fetch.
    const cleanupLiveUpdate = window.api.on('usage:live-update', (data: unknown) => {
      useUiStore.getState().setLiveOverview(data as LiveUsageOverview);
    });
    return () => {
      cleanupLiveUpdate();
    };
  }, []);

  const activeTaskRateLimit = useMemo(
    () => normalizeTaskRateLimit(activeTask?.rateLimitInfo, activeTask?.agentId),
    [activeTask?.rateLimitInfo, activeTask?.agentId],
  );
  const liveRateLimits = useMemo(
    () => (liveOverview?.providers ?? []).flatMap((p) =>
      p.windows.map((w) => ({
        providerId: w.providerId,
        status: w.status,
        resetsAt: w.resetsAt ?? 0,
        rateLimitType: w.windowLabel,
        utilization: w.usedPercent,
        fetchedAt: w.fetchedAt,
      } satisfies RateLimitInfo)),
    ),
    [liveOverview],
  );
  const visibleRateLimits = useMemo(
    () => mergeRateLimits(liveRateLimits, activeTaskRateLimit),
    [liveRateLimits, activeTaskRateLimit],
  );
  const activeRateLimitProvider = useMemo(
    () => resolveRateLimitProvider(activeTask?.agentId ?? selectedAgentId),
    [activeTask?.agentId, selectedAgentId],
  );
  const scopedRateLimits = useMemo(
    () => (
      activeRateLimitProvider
        ? visibleRateLimits.filter((entry) => entry.providerId === activeRateLimitProvider)
        : []
    ),
    [visibleRateLimits, activeRateLimitProvider],
  );
  const highestSeverity = useMemo(
    () => computeHighestSeverity(scopedRateLimits),
    [scopedRateLimits],
  );

  // Tick every 30s to keep reset countdowns fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleAgentClick = useCallback(() => {
    useUiStore.getState().setOverlay('agent-selector');
  }, []);

  const agentName = selectedAgent?.name ?? selectedAgentId;
  const cost = activeTask?.costUsd ?? 0;
  const qualityGate = activeTask?.lastQualityGate;

  return (
    <div className="relative flex h-[30px] min-h-[30px] select-none items-center border-t border-border bg-bg-secondary">
      <div className="flex items-center shrink-0">
        {gitBranch && (
          <span className="flex h-[30px] items-center gap-1.5 border-r border-border px-2.5 text-[13px] text-text-tertiary">
            <GitBranch size={12} />
            {gitBranch}
            {gitDirty && <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />}
          </span>
        )}

        {activeWorkspaceOperation && (
          <span
            className="flex h-[30px] items-center gap-1.5 border-r border-border bg-warning/10 px-2.5 text-[13px] text-warning"
            title={activeWorkspaceOperation.message}
          >
            <LoaderCircle size={12} className="animate-spin" />
            {activeWorkspaceOperation.message}
          </span>
        )}

        {/* Rate limits button */}
        <button
          onClick={() => {
            if (!showRateLimits) {
              void refreshLiveUsage();
            }
            setShowRateLimits((open) => !open);
          }}
          className="premium-toolbar-button flex h-[30px] items-center gap-1.5 rounded-none border-y-0 border-l-0 border-r border-border px-2.5 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
          title={activeRateLimitProvider ? `Peek ${providerLabel(activeRateLimitProvider)} rate limits` : 'Peek rate limits'}
          aria-label="Peek rate limits"
        >
          <Gauge size={12} />
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              highestSeverity === 'rejected'
                ? 'bg-red-400'
                : highestSeverity === 'allowed_warning'
                  ? 'bg-amber-400'
                  : highestSeverity === 'allowed'
                    ? 'bg-emerald-400'
                    : 'bg-text-tertiary/40'
            }`}
          />
          <span className="text-[12px] tabular-nums">
            {scopedRateLimits.length > 0
              ? scopedRateLimits.map((entry, i) => {
                  const pct = Math.round(entry.utilization * 100);
                  const resetLabel = entry.resetsAt > 0 ? formatTimeUntil(entry.resetsAt) : '';
                  const reset = resetLabel && resetLabel !== 'expired' ? ` ↻${resetLabel}` : '';
                  return (
                    <span key={`${entry.providerId}:${entry.rateLimitType}`}>
                      {i > 0 && <span className="text-text-tertiary/40"> · </span>}
                      <span className={rateLimitTextColor(entry)}>
                        {entry.rateLimitType.replace(/[_-]+/g, ' ')} {pct}%{reset}
                      </span>
                    </span>
                  );
                })
              : '—'}
            {liveOverview?.updatedAt && Date.now() - liveOverview.updatedAt > 5 * 60 * 1000 && (
              <span className="text-text-tertiary/50"> · {formatRelativeTime(liveOverview.updatedAt)}</span>
            )}
          </span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 px-3 min-w-0 overflow-hidden">
        <button
          onClick={handleAgentClick}
          className="text-[13px] text-text-tertiary truncate hover:text-text-secondary cursor-pointer transition-colors"
          title="Switch agent (Ctrl+Shift+A)"
        >
          {agentName}
        </button>
        {qualityGate && (
          <>
            <Dot />
            <span className={`text-[13px] font-medium ${
              qualityGate.status === 'passed' ? 'text-success' : 'text-error'
            }`}>
              checks {qualityGate.status}
            </span>
          </>
        )}
        <Dot />
        <span className="text-[13px] text-text-tertiary tabular-nums">
          ${cost.toFixed(4)}
        </span>
      </div>

      {/* Rate limits popover */}
      {showRateLimits && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowRateLimits(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-[320px] rounded-xl border border-border/70 bg-bg-elevated p-3 shadow-2xl">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">
                Rate Limits
              </p>
              <button
                type="button"
                onClick={() => void refreshLiveUsage()}
                className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                title="Refresh rate limits"
                aria-label="Refresh rate limits"
              >
                <RefreshCw size={11} />
              </button>
            </div>

            {scopedRateLimits.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-text-tertiary">
                {activeRateLimitProvider
                  ? `No rate limit data for ${providerLabel(activeRateLimitProvider)}.`
                  : 'No rate limit data yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {providerLabel(activeRateLimitProvider!)}
                </p>
                {scopedRateLimits.map((entry) => (
                  <RateLimitWindowCard
                    key={`${entry.providerId}:${entry.rateLimitType}`}
                    entry={entry}
                  />
                ))}
              </div>
            )}

            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2">
              <p className="text-[10px] text-text-tertiary">
                {liveOverview?.updatedAt ? `Updated ${formatRelativeTime(liveOverview.updatedAt)}` : 'Not refreshed yet'}
              </p>
              <button
                type="button"
                onClick={() => {
                  const store = useUiStore.getState();
                  if (store.workspaceViewMode === 'kanban') {
                    store.setKanbanUsagePanelOpen(true);
                  } else {
                    store.setSidebarOpen(true);
                    store.setSidebarTab('usage');
                  }
                  setShowRateLimits(false);
                }}
                className="rounded-md px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Open usage
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RateLimitWindowCard({ entry }: { entry: RateLimitInfo }) {
  const usedPercent = Math.round(Math.max(0, Math.min(1, entry.utilization)) * 100);
  const remainingPercent = Math.max(0, 100 - usedPercent);
  const barWidth = usedPercent === 0 ? 0 : Math.max(4, usedPercent);
  const statusMeta = rateLimitStatusMeta(entry.status);

  return (
    <div className="rounded-lg border border-border/55 bg-bg-primary/65 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.05)]">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium text-text-primary">
          {entry.rateLimitType.replace(/[_-]+/g, ' ')}
        </p>
        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusMeta.badgeClass}`}>
          {statusMeta.label}
        </span>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[11px] font-semibold tabular-nums text-text-primary">{usedPercent}%</span>
          <span className="text-[10px] text-text-tertiary tabular-nums">
            {remainingPercent}% remaining
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border/30">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${barWidth}%`,
              background: `linear-gradient(90deg, ${statusMeta.ringColor}, color-mix(in oklab, ${statusMeta.ringColor} 80%, white))`,
            }}
          />
        </div>
        <div className="mt-1.5 text-[10px] text-text-tertiary text-right">
          {entry.resetsAt > 0 ? `resets ${formatTimeUntil(entry.resetsAt)}` : 'no reset'}
        </div>
      </div>
    </div>
  );
}

function rateLimitStatusMeta(status: RateLimitInfo['status']): {
  label: string;
  badgeClass: string;
  fillClass: string;
  ringColor: string;
} {
  if (status === 'rejected') {
    return {
      label: 'Limited',
      badgeClass: 'border-error/30 bg-error/10 text-error',
      fillClass: 'bg-error',
      ringColor: 'var(--color-error)',
    };
  }
  if (status === 'allowed_warning') {
    return {
      label: 'Warning',
      badgeClass: 'border-warning/35 bg-warning/12 text-warning',
      fillClass: 'bg-warning',
      ringColor: 'var(--color-warning)',
    };
  }
  return {
    label: 'Healthy',
    badgeClass: 'border-success/30 bg-success/10 text-success',
    fillClass: 'bg-success',
    ringColor: 'var(--color-success)',
  };
}

function Dot() {
  return (
    <span className="text-[13px] text-text-tertiary/60" aria-hidden>
      &middot;
    </span>
  );
}

