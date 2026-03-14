import { FolderOpen, Terminal, Zap, ArrowRight } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore, type RecentProject } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';

interface WelcomeScreenProps {
  onOpenProject: (path?: string, options?: { isSSH?: boolean; sshHost?: string }) => void;
}

const QUICK_ACTIONS = [
  { label: 'Run security audit', prompt: 'Run a security audit on this codebase. Check for common vulnerabilities, exposed secrets, and security best practices.' },
  { label: 'Improve CLAUDE.md', prompt: 'Review and improve the CLAUDE.md file for this project. Make it more comprehensive and useful.' },
  { label: 'Solve a TODO', prompt: 'Find TODO comments in the codebase and help resolve one of them.' },
  { label: 'Explain the codebase', prompt: 'Give me a high-level overview of this codebase - its architecture, key components, and how they fit together.' },
];

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const agents = useAgentStore((s) => s.agents);
  const recentProjects = useUiStore((s) => s.recentProjects);
  const cwd = useUiStore((s) => s.cwd);

  const handleQuickAction = (prompt: string) => {
    const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore.getState();
    const { mode } = useUiStore.getState();
    const taskId = crypto.randomUUID();
    useChatStore.getState().createTask({
      id: taskId,
      title: prompt.slice(0, 80),
      agentId: selectedAgentId,
      model: selectedModel,
      mode,
      thinking: selectedThinking,
      cwd: useUiStore.getState().cwd || '.',
    });
    useChatStore.getState().addUserMessage(taskId, prompt);
    useChatStore.getState().setTaskStatus(taskId, 'running');
    window.api.invoke('task:spawn', {
      taskId,
      prompt,
      agentId: selectedAgentId,
      model: selectedModel,
      mode,
      thinking: selectedThinking,
      cwd: useUiStore.getState().cwd || '.',
    }).catch(() => {
      useChatStore.getState().setTaskStatus(taskId, 'error');
    });
  };

  return (
    <div className="flex flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="premium-panel-strong px-7 py-7">
            <div className="classic-section-label">Workspace</div>
            <h1 className="mt-3 max-w-xl text-4xl font-semibold tracking-[-0.03em] text-text-primary">A calmer shell for coding with agents.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
              Open a repository, connect to a remote machine, or resume recent work. The layout is tuned for long-running sessions instead of noisy dashboard chrome.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ShortcutHint keys="Cmd+K" label="Commands" />
              <ShortcutHint keys="Cmd+B" label="Sidebar" />
              <ShortcutHint keys="Cmd+E" label="Files" />
              <ShortcutHint keys="Ctrl+`" label="Terminal" />
            </div>
          </div>

          <div className="premium-panel flex flex-col justify-between px-6 py-6">
            <div>
              <div className="classic-section-label">Status</div>
              <div className="mt-3 text-sm font-medium text-text-primary">{cwd ? 'Repository ready' : 'No folder open'}</div>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                {cwd
                  ? 'Start a task, inspect files, or branch into isolated workspaces.'
                  : 'Open a local directory or connect over SSH to begin.'}
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-left">
              <div className="premium-panel px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Agents</div>
                <div className="mt-2 text-lg font-semibold text-text-primary">{agents.length}</div>
              </div>
              <div className="premium-panel px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-text-tertiary">Recent</div>
                <div className="mt-2 text-lg font-semibold text-text-primary">{recentProjects.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => onOpenProject()}
            className="premium-toolbar-button premium-panel flex w-full items-start gap-4 p-5 text-left"
          >
            <div className="rounded-lg border border-accent/20 bg-accent-muted/40 p-3 text-accent">
              <FolderOpen size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-text-primary">Open Folder</span>
              <p className="mt-1 text-[11px] leading-5 text-text-tertiary">Select a local project directory and restore your last layout.</p>
            </div>
            <ArrowRight size={14} className="mt-1 text-text-tertiary" />
          </button>

          <button
            onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
            className="premium-toolbar-button premium-panel flex w-full items-start gap-4 p-5 text-left"
          >
            <div className="rounded-lg border border-plan/20 bg-plan-muted/40 p-3 text-plan">
              <Terminal size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-text-primary">SSH Connect</span>
              <p className="mt-1 text-[11px] leading-5 text-text-tertiary">Connect to a remote machine and keep the same shell workflow.</p>
            </div>
            <ArrowRight size={14} className="mt-1 text-text-tertiary" />
          </button>
        </div>

        {cwd && (
          <div className="space-y-2">
            <div className="classic-section-label px-1">Quick Actions</div>
            <div className="flex flex-wrap gap-2.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.prompt)}
                  className="premium-toolbar-button premium-panel rounded-lg px-4 py-2.5 text-[11px] text-text-secondary"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {recentProjects.length > 0 && (
          <div className="space-y-2">
            <h3 className="classic-section-label px-1">
              Recent Projects
            </h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {recentProjects.map((project) => (
                <RecentProjectRow
                  key={project.path}
                  project={project}
                  onClick={() => onOpenProject(project.path, project.isSSH ? { isSSH: true, sshHost: project.sshHost } : undefined)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Detected Agents */}
        {agents.length > 0 && (
          <div className="space-y-2">
            <h3 className="classic-section-label px-1">
              Agents
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="premium-panel flex items-center gap-2.5 px-4 py-3 text-[11px]"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      agent.authStatus === 'authenticated'
                        ? 'bg-success'
                        : agent.authStatus === 'unauthenticated'
                          ? 'bg-error'
                          : 'bg-text-tertiary'
                    }`}
                  />
                  <span className="truncate text-text-secondary">{agent.name}</span>
                </div>
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
      className="premium-toolbar-button premium-panel flex w-full items-center gap-3 px-4 py-4 text-left"
    >
      <Zap size={12} className="text-text-tertiary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="block truncate text-[13px] font-medium text-text-primary">{project.name}</span>
        <span className="mt-1 block truncate text-[10px] text-text-tertiary">{project.path}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {project.isSSH && (
          <span className="premium-pill border border-accent/25 bg-accent-muted/40 px-2 py-1 text-[9px] text-accent">SSH</span>
        )}
        <span className="text-[10px] text-text-tertiary">{timeAgo}</span>
      </div>
    </button>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <kbd className="premium-pill px-2 py-1 text-[9px] font-mono text-text-tertiary">
        {keys}
      </kbd>
      <span className="text-[9px] uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
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
