import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useIntelligenceStore } from '../../stores/intelligence';
import { useWorkspaceStore } from '../../stores/workspace';
import { GitBranch, Wifi, WifiOff, Brain, Monitor, Terminal, LoaderCircle, Gauge, RefreshCw } from 'lucide-react';
import type { ThinkingLevel } from '../../lib/types';
import type { LiveUsageOverview } from '../../lib/ipc-api';
import { isWorkspaceArchiving } from '../../lib/workspace-operations';
import {
  computeHighestSeverity,
  formatTimeUntil,
  mergeRateLimits,
  normalizeTaskRateLimit,
  providerLabel,
  rateLimitTextColor,
} from '../../lib/rate-limits';

export function StatusLine() {
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });
  const selectedThinking = useAgentStore((s) => s.selectedThinking);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);
  const environment = useUiStore((s) => s.environment);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceOperation = useWorkspaceStore((s) => (activeWorkspaceId ? s.workspaceOperations.get(activeWorkspaceId) : undefined));
  const activeWorkspaceOperation = isWorkspaceArchiving(workspaceOperation) ? workspaceOperation : null;

  const repoMapConfig = useIntelligenceStore((s) => s.config);
  const repoMapStatus = useIntelligenceStore((s) => s.status);

  const selectedModel = useAgentStore((s) => s.selectedModel);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);

  const thinkingLevels: ThinkingLevel[] = useMemo(() => ['disabled', 'low', 'medium', 'high', 'xhigh'], []);

  // Rate limits state
  const [showRateLimits, setShowRateLimits] = useState(false);
  const [liveOverview, setLiveOverview] = useState<LiveUsageOverview | null>(null);

  const refreshLiveUsage = useCallback(async () => {
    try {
      const result = await window.api.invoke('usage:live') as LiveUsageOverview;
      setLiveOverview(result);
    } catch {
      // keep previous state
    }
  }, []);

  useEffect(() => {
    void refreshLiveUsage();
    const cleanupLiveUpdate = window.api.on('usage:live-update', (data: unknown) => {
      setLiveOverview(data as LiveUsageOverview);
    });
    const cleanupMessage = window.api.on('agent:message', (...args: unknown[]) => {
      const data = args[0] as { message?: { type?: string } } | undefined;
      if (data?.message?.type === 'rate_limit') {
        void refreshLiveUsage();
      }
    });
    const cleanupDone = window.api.on('agent:done', () => {
      void refreshLiveUsage();
    });
    return () => {
      cleanupLiveUpdate();
      cleanupMessage();
      cleanupDone();
    };
  }, [refreshLiveUsage]);

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
      } satisfies import('../../lib/ipc-api').RateLimitInfo)),
    ),
    [liveOverview],
  );
  const visibleRateLimits = useMemo(
    () => mergeRateLimits(liveRateLimits, activeTaskRateLimit),
    [liveRateLimits, activeTaskRateLimit],
  );
  const highestSeverity = useMemo(
    () => computeHighestSeverity(visibleRateLimits),
    [visibleRateLimits],
  );

  const handleCycleModel = useCallback(() => {
    const modelIds = dynamicModels.length > 0
      ? dynamicModels.map((m) => m.id)
      : selectedAgent?.models ?? [];
    if (modelIds.length === 0) return;
    const idx = modelIds.indexOf(selectedModel);
    useAgentStore.getState().setSelectedModel(modelIds[(idx + 1) % modelIds.length]);
  }, [dynamicModels, selectedAgent, selectedModel]);

  const handleCycleThinking = useCallback(() => {
    const idx = thinkingLevels.indexOf(selectedThinking);
    useAgentStore.getState().setSelectedThinking(thinkingLevels[(idx + 1) % thinkingLevels.length]);
  }, [selectedThinking, thinkingLevels]);

  const handleAgentClick = useCallback(() => {
    useUiStore.getState().setOverlay('agent-selector');
  }, []);

  const agentName = selectedAgent?.name ?? selectedAgentId;
  const rawModel = activeTask?.model ?? selectedModel;
  const model = dynamicModels.find((m) => m.id === rawModel)?.name
    ?? dynamicModels.find((m) => rawModel.includes(m.id))?.name
    ?? rawModel;
  const thinking = activeTask?.thinking ?? selectedThinking;
  const cost = activeTask?.costUsd ?? 0;
  const tokens = (activeTask?.inputTokens ?? 0) + (activeTask?.outputTokens ?? 0);
  const qualityGate = activeTask?.lastQualityGate;

  const handleSshClick = useCallback(() => {
    useUiStore.getState().setOverlay('ssh-connect');
  }, []);

  return (
    <div className="relative flex h-[30px] min-h-[30px] select-none items-center border-t border-border bg-bg-secondary">
      <div className="flex items-center shrink-0">
        {environment === 'wsl' && (
          <span
            className="flex h-[30px] items-center gap-1.5 border-r border-border bg-warning/12 px-2.5 text-[13px] font-medium text-warning"
            title="Running inside WSL"
          >
            <Terminal size={12} />
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span
            className="flex h-[30px] items-center gap-1.5 border-r border-border bg-info/12 px-2.5 text-[13px] font-medium text-info"
            title="Running inside an SSH session"
          >
            <Monitor size={12} />
            SSH Session
          </span>
        )}
        <button
          onClick={handleSshClick}
          className={`premium-toolbar-button flex h-[30px] items-center gap-1.5 rounded-none border-y-0 border-l-0 px-2.5 text-[13px] font-medium ${
            sshConnected
              ? 'border-r border-success/20 bg-success/8 text-success'
              : 'border-r border-border text-text-tertiary'
          }`}
          title={sshConnected ? `SSH: ${sshHost} (click to manage)` : 'Connect to SSH remote'}
        >
          {sshConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {sshConnected ? `SSH: ${sshHost}` : 'SSH'}
        </button>

        {gitBranch && (
          <span className="flex h-[30px] items-center gap-1.5 border-r border-border px-2.5 text-[13px] text-text-tertiary">
            <GitBranch size={12} />
            {gitBranch}
            {gitDirty && <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />}
          </span>
        )}

        <button
          onClick={() => useUiStore.getState().setOverlay('context-settings')}
          className={`premium-toolbar-button flex h-[30px] items-center gap-1 rounded-none border-y-0 border-l-0 border-r border-border px-2.5 text-[13px] ${
            !repoMapConfig.enabled
              ? 'text-text-tertiary'
            : repoMapStatus.state === 'ready'
                ? 'text-success'
                : repoMapStatus.state === 'building'
                  ? 'text-warning'
                  : repoMapStatus.state === 'error'
                    ? 'text-error'
                    : 'text-text-tertiary'
          }`}
          title={
            !repoMapConfig.enabled
              ? 'Repo map: off (click to configure)'
              : `Repo map: ${repoMapStatus.state} (${repoMapStatus.totalTags} tags)`
          }
        >
          <Brain size={12} className={repoMapStatus.state === 'building' ? 'animate-pulse' : ''} />
          {repoMapConfig.enabled && <span>{repoMapStatus.state === 'building' ? 'indexing' : 'map'}</span>}
        </button>
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
          title="Peek rate limits"
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
        <Dot />
        <button
          onClick={handleCycleModel}
          className="text-[13px] text-text-tertiary truncate hover:text-text-secondary cursor-pointer transition-colors"
          title="Cycle model (Ctrl+Shift+M)"
        >
          {model}
        </button>
        <Dot />
        <button
          onClick={handleCycleThinking}
          className="text-[13px] text-text-tertiary truncate hover:text-text-secondary cursor-pointer transition-colors"
          title="Cycle thinking level (Ctrl+Shift+T)"
        >
          think {thinking}
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
        <span className="text-[13px] text-text-tertiary tabular-nums">
          {formatTokens(tokens)} tok
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

            {visibleRateLimits.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-text-tertiary">No rate limit data yet.</p>
            ) : (
              <div className="space-y-2">
                {visibleRateLimits.map((entry) => {
                  const pct = Math.round(Math.max(0, Math.min(1, entry.utilization)) * 100);
                  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
                  return (
                    <div
                      key={`${entry.providerId}:${entry.rateLimitType}`}
                      className="rounded-lg border border-border/50 bg-bg-primary/60 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] font-medium text-text-primary">
                          {providerLabel(entry.providerId)}
                        </p>
                        <span className={`text-[11px] font-bold tabular-nums ${rateLimitTextColor(entry)}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border/30">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
                        <span className="truncate">{entry.rateLimitType.replace(/[_-]+/g, ' ')}</span>
                        <span className="shrink-0">
                          {entry.resetsAt > 0 ? `resets ${formatTimeUntil(entry.resetsAt)}` : 'no reset'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2">
              <p className="text-[10px] text-text-tertiary">
                {liveOverview?.updatedAt ? `Updated ${formatRelativeTime(liveOverview.updatedAt)}` : 'Not refreshed yet'}
              </p>
              <button
                type="button"
                onClick={() => {
                  useUiStore.getState().setSidebarOpen(true);
                  useUiStore.getState().setSidebarTab('usage');
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

function Dot() {
  return (
    <span className="text-[13px] text-text-tertiary/60" aria-hidden>
      &middot;
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
