import { Zap } from 'lucide-react';
import { useUiStore, type RecentProject } from '../../stores/ui';

interface WelcomeScreenProps {
  onOpenProject: (path?: string, options?: { isSSH?: boolean; sshHost?: string }) => void;
}

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const recentProjects = useUiStore((s) => s.recentProjects);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-[480px]">
        <div className="mb-8 text-center">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">Start a conversation</h2>
          <p className="mt-2 text-[14px] text-text-tertiary">Type a message below or press <kbd className="premium-pill px-1.5 py-0.5 text-[12px] font-mono text-text-secondary">Cmd+K</kbd> to open commands</p>
        </div>

        {recentProjects.length > 0 && (
          <div>
            <div className="classic-section-label mb-2 px-1">Recent Projects</div>
            <div className="space-y-1.5">
              {recentProjects.slice(0, 5).map((project) => (
                <RecentProjectRow
                  key={project.path}
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
        <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">{project.path}</span>
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
