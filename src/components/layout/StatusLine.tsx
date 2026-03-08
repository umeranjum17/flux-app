import { useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { useIntelligenceStore } from '../../stores/intelligence';
import { GitBranch, Wifi, WifiOff, FolderOpen, Brain } from 'lucide-react';

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

  const repoMapConfig = useIntelligenceStore((s) => s.config);
  const repoMapStatus = useIntelligenceStore((s) => s.status);

  const selectedModel = useAgentStore((s) => s.selectedModel);

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
    <div className="flex items-center h-7 min-h-[28px] bg-bg-secondary border-t border-border select-none">
      {/* Left side: Remote indicator + folder */}
      <div className="flex items-center gap-0 shrink-0">
        {/* VS Code-style remote indicator */}
        <button
          onClick={handleSshClick}
          className={`flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium transition-colors ${
            sshConnected
              ? 'bg-accent text-white hover:opacity-90'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
          }`}
          title={sshConnected ? `SSH: ${sshHost} (click to manage)` : 'Connect to SSH remote'}
        >
          {sshConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {sshConnected ? `SSH: ${sshHost}` : 'SSH'}
        </button>

        {/* Open Folder button */}
        <button
          onClick={handleOpenFolder}
          className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="Open folder"
        >
          <FolderOpen size={11} />
          {shortCwd || 'Open Folder'}
        </button>

        {gitBranch && (
          <span className="flex items-center gap-1 h-7 px-2 text-[11px] text-text-tertiary">
            <GitBranch size={11} />
            {gitBranch}
            {gitDirty && <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />}
          </span>
        )}

        {/* Repo map indicator */}
        <button
          onClick={() => useUiStore.getState().setOverlay('context-settings')}
          className={`flex items-center gap-1 h-7 px-2 text-[11px] transition-colors hover:bg-bg-hover ${
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side: agent, model, cost, tokens */}
      <div className="flex items-center gap-2 px-3">
        <span className="text-[11px] text-text-tertiary truncate">
          {agentName}
        </span>
        <Dot />
        <span className="text-[11px] text-text-tertiary truncate">
          {model}
        </span>
        <Dot />
        <span className="text-[11px] text-text-tertiary truncate">
          think {thinking}
        </span>
        {qualityGate && (
          <>
            <Dot />
            <span className={`text-[11px] font-medium ${
              qualityGate.status === 'passed' ? 'text-success' : 'text-error'
            }`}>
              checks {qualityGate.status}
            </span>
          </>
        )}
        {rateLimit && (
          <>
            <Dot />
            <span className={`text-[11px] font-medium ${rateLimitColor(rateLimit.utilization)}`}>
              rl {Math.round(rateLimit.utilization * 100)}%
            </span>
          </>
        )}
        <Dot />
        <span className="text-[11px] text-text-tertiary tabular-nums">
          ${cost.toFixed(4)}
        </span>
        <span className="text-[11px] text-text-tertiary tabular-nums">
          {formatTokens(tokens)} tokens
        </span>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span className="text-[11px] text-text-tertiary" aria-hidden>
      &middot;
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
