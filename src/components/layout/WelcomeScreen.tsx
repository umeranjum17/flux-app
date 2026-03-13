import { FolderOpen, Terminal, Keyboard, Zap, ArrowRight } from 'lucide-react';
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
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="premium-panel-strong rounded-[28px] px-6 py-8 text-center">
          <div className="mx-auto mb-3 inline-flex items-center rounded-full border border-plan/20 bg-plan/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-plan">
            Premium workspace orchestration
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-text-primary">Flux</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-text-secondary">
            Coordinate coding agents in a workspace that feels intentional, warm, and fast to read.
          </p>
        </div>

        {/* Open Folder + SSH */}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onOpenProject()}
            className="premium-toolbar-button premium-panel w-full rounded-[24px] p-4 text-left group"
          >
            <div className="rounded-2xl border border-accent/20 bg-accent-muted/45 p-3 text-accent transition-colors group-hover:border-accent/30">
              <FolderOpen size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-text-primary">Open Folder</span>
              <p className="mt-0.5 text-[11px] text-text-tertiary">Select a project directory</p>
            </div>
            <ArrowRight size={14} className="text-text-tertiary opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
          </button>

          <button
            onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
            className="premium-toolbar-button premium-panel w-full rounded-[24px] p-4 text-left group"
          >
            <div className="rounded-2xl border border-plan/20 bg-plan-muted/50 p-3 text-plan transition-colors group-hover:border-plan/30">
              <Terminal size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-text-primary">SSH Connect</span>
              <p className="mt-0.5 text-[11px] text-text-tertiary">Connect to a remote machine</p>
            </div>
            <ArrowRight size={14} className="text-text-tertiary opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
          </button>
        </div>

        {/* Quick Actions — only if a project is open */}
        {cwd && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.prompt)}
                className="premium-toolbar-button premium-panel rounded-full px-4 py-2 text-[11px] text-text-secondary"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
              Recent Projects
            </h3>
            <div className="space-y-2">
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
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-1">
              Agents
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="premium-panel flex items-center gap-2 rounded-2xl px-3 py-2 text-[11px]"
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
                  <span className="text-text-secondary truncate">{agent.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard hints */}
        <div className="flex items-center justify-center gap-5 pt-1">
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
      className="premium-toolbar-button premium-panel w-full rounded-2xl px-3 py-3 text-left group"
    >
      <Zap size={12} className="text-text-tertiary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[12px] text-text-primary truncate block">{project.name}</span>
        <span className="text-[10px] text-text-tertiary truncate block">{project.path}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {project.isSSH && (
          <span className="premium-pill rounded-full border border-accent/25 bg-accent-muted/40 px-2 py-0.5 text-[9px] text-accent">SSH</span>
        )}
        <span className="text-[10px] text-text-tertiary">{timeAgo}</span>
      </div>
    </button>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <kbd className="premium-pill rounded-md px-1.5 py-0.5 text-[9px] font-mono text-text-tertiary">
        {keys}
      </kbd>
      <span className="text-[9px] text-text-tertiary">{label}</span>
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
