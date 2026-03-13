import { useCallback, useMemo } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useIntelligenceStore } from '../../stores/intelligence';
import { GitBranch, Wifi, WifiOff, FolderOpen, Brain, Monitor, Terminal } from 'lucide-react';
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

  const cwd = useUiStore((s) => s.cwd);
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

  const shortCwd = cwd ? truncatePath(cwd, 30) : '';

  const handleSshClick = useCallback(() => {
    useUiStore.getState().setOverlay('ssh-connect');
  }, []);

  const handleOpenFolder = useCallback(async () => {
    if (sshConnected) {
      useUiStore.getState().setOverlay('remote-folder-picker');
      return;
    }
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().setCwd(picked);
    }
  }, [sshConnected]);

  return (
    <div className="flex items-center h-[28px] min-h-[28px] bg-bg-secondary border-t border-border select-none">
      {/* Left side: Remote indicator + folder */}
      <div className="flex items-center gap-0 shrink-0">
        {environment === 'wsl' && (
          <span
            className="flex items-center gap-1.5 h-[28px] px-2.5 text-[10px] font-medium bg-blue-600 text-white"
            title="Running inside WSL"
          >
            <Terminal size={11} />
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span
            className="flex items-center gap-1.5 h-[28px] px-2.5 text-[10px] font-medium bg-purple-600 text-white"
            title="Running inside an SSH session"
          >
            <Monitor size={11} />
            SSH Session
          </span>
        )}
        <button
          onClick={handleSshClick}
          className={`flex items-center gap-1.5 h-[28px] px-2.5 text-[10px] font-medium transition-colors ${
            sshConnected
              ? 'bg-accent text-white hover:opacity-90'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
          }`}
          title={sshConnected ? `SSH: ${sshHost} (click to manage)` : 'Connect to SSH remote'}
        >
          {sshConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {sshConnected ? `SSH: ${sshHost}` : 'SSH'}
        </button>

        <button
          onClick={handleOpenFolder}
          className="flex items-center gap-1.5 h-[28px] px-2.5 text-[10px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="Open folder"
        >
          <FolderOpen size={11} />
          {shortCwd || 'Open Folder'}
        </button>

        {gitBranch && (
          <span className="flex items-center gap-1.5 h-[28px] px-2.5 text-[10px] text-text-tertiary">
            <GitBranch size={11} />
            {gitBranch}
            {gitDirty && <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />}
          </span>
        )}

        <button
          onClick={() => useUiStore.getState().setOverlay('context-settings')}
          className={`flex items-center gap-1 h-[28px] px-2.5 text-[10px] transition-colors hover:bg-bg-hover ${
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
          <Brain size={11} className={repoMapStatus.state === 'building' ? 'animate-pulse' : ''} />
          {repoMapConfig.enabled && <span>{repoMapStatus.state === 'building' ? 'indexing' : 'map'}</span>}
        </button>
      </div>

      <div className="flex-1" />

      {/* Right side: agent, model, cost, tokens */}
      <div className="flex items-center gap-0 px-1 min-w-0 overflow-hidden">
        <StatusButton onClick={handleAgentClick} title="Switch agent (Ctrl+Shift+A)">
          {agentName}
        </StatusButton>
        <Dot />
        <StatusButton onClick={handleCycleModel} title="Cycle model (Ctrl+Shift+M)">
          {model}
        </StatusButton>
        <Dot />
        <StatusButton onClick={handleCycleThinking} title="Cycle thinking level (Ctrl+Shift+T)">
          think:{thinking}
        </StatusButton>
        {qualityGate && (
          <>
            <Dot />
            <span className={`text-[10px] font-medium px-2 h-[28px] flex items-center ${
              qualityGate.status === 'passed' ? 'text-success' : 'text-error'
            }`}>
              checks {qualityGate.status}
            </span>
          </>
        )}
        {rateLimit && Number.isFinite(rateLimit.utilization) && (
          <>
            <Dot />
            <span className={`text-[10px] font-medium px-2 h-[28px] flex items-center ${rateLimitColor(rateLimit.utilization)}`}>
              rl {Math.round(rateLimit.utilization * 100)}%
            </span>
          </>
        )}
        <Dot />
        <span className="text-[10px] text-text-tertiary tabular-nums px-2 h-[28px] flex items-center gap-1.5">
          <span>${cost.toFixed(4)}</span>
          <span className="text-text-tertiary/30">|</span>
          <span>{formatTokens(tokens)} tok</span>
        </span>
      </div>
    </div>
  );
}

function StatusButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] text-text-tertiary truncate hover:text-text-secondary hover:bg-bg-hover px-2 h-[28px] flex items-center cursor-pointer transition-colors"
      title={title}
    >
      {children}
    </button>
  );
}

function Dot() {
  return (
    <span className="text-text-tertiary/30 text-[8px] flex items-center h-[28px]" aria-hidden>
      &bull;
    </span>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function truncatePath(p: string, maxLen: number): string {
  if (p.length <= maxLen) return p;
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return `.../${parts.slice(-2).join('/')}`;
}

function rateLimitColor(utilization: number): string {
  if (utilization >= 0.8) return 'text-error';
  if (utilization >= 0.5) return 'text-warning';
  return 'text-success';
}
