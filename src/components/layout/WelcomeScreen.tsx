import { FolderOpen, Terminal, Keyboard, Zap } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore, type RecentProject } from '../../stores/ui';

interface WelcomeScreenProps {
  onOpenProject: (path?: string) => void;
}

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const agents = useAgentStore((s) => s.agents);
  const recentProjects = useUiStore((s) => s.recentProjects);

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto p-8">
      <div className="max-w-lg w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-text-primary">Flux</h1>
          <p className="text-sm text-text-secondary">AI coding agent orchestrator</p>
        </div>

        {/* Open Folder */}
        <button
          onClick={() => onOpenProject()}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-bg-elevated hover:bg-bg-hover transition-colors text-left group"
        >
          <div className="p-2.5 rounded-lg bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
            <FolderOpen size={20} />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary">Open Folder</span>
            <p className="text-xs text-text-tertiary mt-0.5">Select a project directory to get started</p>
          </div>
        </button>

        {/* SSH Connect */}
        <button
          onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
          className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-bg-elevated hover:bg-bg-hover transition-colors text-left group"
        >
          <div className="p-2.5 rounded-lg bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
            <Terminal size={20} />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary">SSH Connect</span>
            <p className="text-xs text-text-tertiary mt-0.5">Connect to a remote machine via SSH</p>
          </div>
        </button>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary px-1">
              Recent Projects
            </h3>
            <div className="space-y-1">
              {recentProjects.map((project) => (
                <RecentProjectRow
                  key={project.path}
                  project={project}
                  onClick={() => onOpenProject(project.path)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Detected Agents */}
        {agents.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary px-1">
              Agents
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated border border-border text-xs"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      agent.authStatus === 'authenticated'
                        ? 'bg-success'
                        : agent.authStatus === 'unauthenticated'
                          ? 'bg-error'
                          : 'bg-text-tertiary'
                    }`}
                  />
                  <span className="text-text-secondary truncate">{agent.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard hints */}
        <div className="flex items-center justify-center gap-6 pt-2">
          <ShortcutHint keys="Cmd+K" label="Commands" />
          <ShortcutHint keys="Cmd+B" label="Sidebar" />
          <ShortcutHint keys="Cmd+E" label="Explorer" />
          <ShortcutHint keys="Ctrl+`" label="Terminal" />
        </div>
      </div>
    </div>
  );
}

function RecentProjectRow({ project, onClick }: { project: RecentProject; onClick: () => void }) {
  const timeAgo = formatTimeAgo(project.lastOpened);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-hover transition-colors text-left"
    >
      <Zap size={14} className="text-text-tertiary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-primary truncate block">{project.name}</span>
        <span className="text-[10px] text-text-tertiary truncate block">{project.path}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {project.isSSH && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent">SSH</span>
        )}
        <span className="text-[10px] text-text-tertiary">{timeAgo}</span>
      </div>
    </button>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Keyboard size={10} className="text-text-tertiary" />
      <kbd className="text-[10px] text-text-tertiary bg-bg-primary border border-border rounded px-1.5 py-0.5 font-mono">
        {keys}
      </kbd>
      <span className="text-[10px] text-text-tertiary">{label}</span>
    </div>
  );
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
