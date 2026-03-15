import { useCallback, useMemo } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useIntelligenceStore } from '../../stores/intelligence';
import { GitBranch, Wifi, WifiOff, Brain, Monitor, Terminal } from 'lucide-react';
import type { ThinkingLevel } from '../../lib/types';

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

  const repoMapConfig = useIntelligenceStore((s) => s.config);
  const repoMapStatus = useIntelligenceStore((s) => s.status);

  const selectedModel = useAgentStore((s) => s.selectedModel);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);

  const thinkingLevels: ThinkingLevel[] = useMemo(() => ['low', 'medium', 'high', 'xhigh'], []);

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
  const model = activeTask?.model ?? selectedModel;
  const thinking = activeTask?.thinking ?? selectedThinking;
  const cost = activeTask?.costUsd ?? 0;
  const tokens = (activeTask?.inputTokens ?? 0) + (activeTask?.outputTokens ?? 0);
  const qualityGate = activeTask?.lastQualityGate;
  const rateLimit = activeTask?.rateLimitInfo;

  const handleSshClick = useCallback(() => {
    useUiStore.getState().setOverlay('ssh-connect');
  }, []);

  return (
    <div className="flex h-[30px] min-h-[30px] select-none items-center border-t border-border bg-bg-secondary">
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
        {rateLimit && Number.isFinite(rateLimit.utilization) && (
          <>
            <Dot />
            <span className={`text-[13px] font-medium ${rateLimitColor(rateLimit.utilization)}`}>
              rl {Math.round(rateLimit.utilization * 100)}%
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

function rateLimitColor(utilization: number): string {
  if (utilization >= 0.8) return 'text-error';
  if (utilization >= 0.5) return 'text-warning';
  return 'text-success';
}
