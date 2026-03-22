import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, FolderPlus, GitBranch, MessageSquare, Plus, RefreshCw, GitCommitHorizontal } from 'lucide-react';
import { getRecentProjectKey, useUiStore, type RecentProject } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { createEmptyWorkspace } from '../../lib/workspace-state';
import { getWorkspaceLifecycleState, workspaceLifecycleConfig } from '../../lib/workspace-status';
import { WorkspaceLifecycleIcon } from '../workspace/WorkspaceLifecycleIcon';
import { toast } from 'sonner';
import type { LiveUsageOverview, LiveUsageProvider, LiveUsageWindow } from '../../lib/ipc-api';
import { AnimatedWorkspaceName } from '../workspace/AnimatedWorkspaceName';

interface WelcomeScreenProps {
  onOpenProject: (path?: string, options?: { isSSH?: boolean; sshHost?: string }) => void;
}

const STATUS_COLORS: Record<LiveUsageWindow['status'], string> = {
  allowed: 'var(--color-success)',
  allowed_warning: 'var(--color-warning)',
  rejected: 'var(--color-error)',
};

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const recentProjects = useUiStore((s) => s.recentProjects);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const cwd = useUiStore((s) => s.cwd);
  const isGitRepo = useUiStore((s) => s.isGitRepo);

  const recentWorkspaces = useMemo(
    () => Array.from(workspaces.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6),
    [workspaces],
  );

  const hasWorkspaces = recentWorkspaces.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-[720px]">
        {/* Header */}
        <div className="mb-8 text-center">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">Start a conversation</h2>
          <p className="mt-2 text-[14px] text-text-tertiary">Type a message below or press <kbd className="premium-pill px-1.5 py-0.5 text-[12px] font-mono text-text-secondary">Cmd+K</kbd> to open commands</p>
        </div>

        <div className="mb-6 flex justify-center gap-2">
          <button
            onClick={() => useUiStore.getState().setOverlay('create-folder')}
            className="premium-toolbar-button inline-flex items-center gap-2 rounded-lg border border-border/70 bg-bg-surface/70 px-4 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <FolderPlus size={14} />
            Create New Project
          </button>
          {!isGitRepo && cwd && (
            <InitGitButton cwd={cwd} />
          )}
        </div>

        {/* Workspaces grid */}
        {hasWorkspaces && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="classic-section-label">Recent Workspaces</span>
              <NewWorkspaceButton cwd={cwd} isGitRepo={isGitRepo} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {recentWorkspaces.map((ws) => (
                <WorkspaceCard key={ws.id} workspace={ws} />
              ))}
            </div>
          </div>
        )}

        {/* Usage dashboard */}
        <div className="mb-8">
          <UsageDashboard />
        </div>

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div>
            <div className="classic-section-label mb-2 px-1">Recent Projects</div>
            <div className="space-y-1.5">
              {recentProjects.slice(0, 5).map((project) => (
                <RecentProjectRow
                  key={getRecentProjectKey(project)}
                  project={project}
                  onClick={() => onOpenProject(project.path, project.isSSH ? { isSSH: true, sshHost: project.sshHost } : undefined)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Workspace Card ---

function WorkspaceCard({ workspace }: { workspace: import('../../lib/ipc-api').Workspace }) {
  const handleClick = useCallback(() => {
    const wsStore = useWorkspaceStore.getState();
    const chatStore = useChatStore.getState();
    wsStore.setActiveWorkspace(workspace.id);
    useUiStore.getState().setActiveProject(workspace.parentRepo);

    const wsTask = Array.from(chatStore.tasks.values())
      .filter((t) => t.workspaceId === workspace.id)
      .sort((a, b) => (b.activeRun?.startedAt ?? 0) - (a.activeRun?.startedAt ?? 0))[0];
    if (wsTask) {
      chatStore.setActiveTask(wsTask.id);
    }
    useUiStore.getState().setBottomPanelMode('agent');
  }, [workspace.id, workspace.parentRepo]);

  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;

  return (
    <button
      onClick={handleClick}
      className="group flex flex-col gap-2 rounded-xl border border-border/60 bg-bg-elevated/60 p-3.5 text-left transition-all hover:border-border hover:bg-bg-elevated/90 hover:shadow-lg"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1 shrink-0">
          <WorkspaceLifecycleIcon state={lifecycleState} size={14} className={lifecycle.iconColor} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text-primary">
            <AnimatedWorkspaceName name={workspace.name} />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary">
            <GitBranch size={10} className="opacity-50" />
            <span className="truncate font-mono">{workspace.branch}</span>
          </div>
        </div>
        <MessageSquare size={12} className="shrink-0 text-text-tertiary/40 mt-0.5" />
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-tertiary">
        <span className="truncate">{basename(workspace.parentRepo)}</span>
        <span className="shrink-0">{formatTimeAgo(workspace.updatedAt)}</span>
      </div>
    </button>
  );
}

// --- New Workspace Button ---

function NewWorkspaceButton({ cwd, isGitRepo }: { cwd: string; isGitRepo: boolean }) {
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    if (creating) return;

    // If not a git repo, offer to initialize git first
    if (!isGitRepo) {
      setCreating(true);
      try {
        const result = await window.api.invoke('git:init', { dirPath: cwd }) as { success: boolean; error?: string };
        if (!result.success) {
          toast.error(result.error || 'Failed to initialize git');
          return;
        }
        useUiStore.getState().setIsGitRepo(true);
        const branch = await window.api.invoke('git:branch') as string | null;
        useUiStore.getState().setGitBranch(branch);
        toast.success('Git repository initialized');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setCreating(false);
      }
    }

    setCreating(true);
    try {
      const { selectedAgentId: agentId, selectedModel: model, selectedThinking } = useAgentStore.getState();
      const mode = useUiStore.getState().mode;
      const ws = await createEmptyWorkspace({ agentId, model, mode, thinking: selectedThinking, cwd });
      const taskId = crypto.randomUUID();
      useChatStore.getState().createTask({
        id: taskId,
        title: 'New chat',
        agentId: ws.agentId as any,
        model: ws.model,
        mode: ws.mode ?? mode,
        thinking: ws.thinking ?? selectedThinking,
        cwd: ws.worktreePath,
        workspaceId: ws.id,
      });
      useChatStore.getState().setActiveTask(taskId);
      useUiStore.getState().setBottomPanelMode('agent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [creating, isGitRepo, cwd]);

  return (
    <button
      onClick={handleCreate}
      disabled={creating}
      className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary disabled:opacity-50"
      title={isGitRepo ? 'New workspace' : 'Initialize git & create workspace'}
    >
      <Plus size={12} />
      New
    </button>
  );
}

// --- Init Git Button ---

function InitGitButton({ cwd }: { cwd: string }) {
  const [initing, setIniting] = useState(false);

  const handleInit = useCallback(async () => {
    if (initing) return;
    setIniting(true);
    try {
      const result = await window.api.invoke('git:init', { dirPath: cwd }) as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || 'Failed to initialize git');
        return;
      }
      useUiStore.getState().setIsGitRepo(true);
      // Re-detect git state
      const branch = await window.api.invoke('git:branch') as string | null;
      useUiStore.getState().setGitBranch(branch);
      toast.success('Git repository initialized');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIniting(false);
    }
  }, [cwd, initing]);

  return (
    <button
      onClick={handleInit}
      disabled={initing}
      className="premium-toolbar-button inline-flex items-center gap-2 rounded-lg border border-border/70 bg-bg-surface/70 px-4 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
    >
      <GitCommitHorizontal size={14} />
      {initing ? 'Initializing...' : 'Initialize Git'}
    </button>
  );
}

// --- Usage Dashboard (center, polished) ---

function UsageDashboard() {
  const [liveUsage, setLiveUsage] = useState<LiveUsageOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await window.api.invoke('usage:live') as LiveUsageOverview;
      setLiveUsage(result);
    } catch {
      // best-effort
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
    const cleanup = window.api.on('usage:live-update', (data: unknown) => {
      setLiveUsage(data as LiveUsageOverview);
    });
    return cleanup;
  }, [loadUsage]);

  const providers = useMemo(() => liveUsage?.providers ?? [], [liveUsage]);
  const hasContent = providers.some((p) => p.windows.length > 0);

  if (!hasContent) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-bg-elevated/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Usage</span>
        <div className="flex items-center gap-2">
          {liveUsage?.updatedAt && (
            <span className="text-[10px] text-text-tertiary">
              Updated {formatRelativeTime(liveUsage.updatedAt)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadUsage()}
            className="rounded-md p-1 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border/30">
        {providers.map((provider) => (
          <ProviderDashboardCard key={provider.providerId} provider={provider} />
        ))}
      </div>
    </div>
  );
}

function ProviderDashboardCard({ provider }: { provider: LiveUsageProvider }) {
  const hasWindows = provider.windows.length > 0;
  if (!hasWindows && provider.status !== 'connected') return null;

  return (
    <div className="bg-bg-elevated/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: provider.providerId === 'claude-code' ? 'var(--color-info)' : 'var(--color-accent)' }}
        />
        <span className="text-[13px] font-medium text-text-primary">{provider.label}</span>
        {provider.status === 'connected' && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success shrink-0" />
        )}
      </div>

      <div className="space-y-3">
        {provider.windows.map((w) => (
          <UsageBar key={`${w.providerId}-${w.windowKey}`} window={w} />
        ))}
      </div>
    </div>
  );
}

function UsageBar({ window: w }: { window: LiveUsageWindow }) {
  const pct = Math.round(Math.max(0, Math.min(1, w.usedPercent)) * 100);
  const remaining = Math.max(0, 100 - pct);
  const barWidth = pct === 0 ? 0 : Math.max(4, pct);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-text-secondary font-medium">{w.windowLabel}</span>
        <span className="text-[13px] font-semibold text-text-primary tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-hover/80">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${barWidth}%`,
            background: `linear-gradient(90deg, ${STATUS_COLORS[w.status]}, color-mix(in oklab, ${STATUS_COLORS[w.status]} 75%, white))`,
          }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-text-tertiary">
        <span>{remaining}% remaining{w.isStale ? ' \u00b7 stale' : ''}</span>
        {w.resetsAt ? <span>resets in {formatTimeUntilShort(w.resetsAt)}</span> : <span>no reset</span>}
      </div>
    </div>
  );
}

// --- Helpers ---

function RecentProjectRow({ project, onClick }: { project: RecentProject; onClick: () => void }) {
  const timeAgo = formatTimeAgo(project.lastOpened);
  return (
    <button
      onClick={onClick}
      className="premium-toolbar-button premium-panel flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <Zap size={12} className="text-text-tertiary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="block truncate text-[14px] font-medium text-text-primary">{project.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">
          {project.isSSH && project.sshHost ? `${project.sshHost} · ` : ''}
          {project.path}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {project.isSSH && (
          <span className="premium-pill border border-success/25 bg-success/8 px-2 py-1 text-[11px] text-success">SSH</span>
        )}
        <span className="text-[12px] text-text-tertiary">{timeAgo}</span>
      </div>
    </button>
  );
}

function basename(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
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

function formatTimeUntilShort(timestamp: number): string {
  const diffMs = Math.max(0, timestamp - Date.now());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
