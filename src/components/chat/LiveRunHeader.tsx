import { useEffect, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';

const STALLED_THRESHOLDS: Record<string, number> = {
  tool: 60_000,
  thinking: 45_000,
  default: 30_000,
};

const phaseLabels = {
  starting: 'Starting',
  progress: 'Working',
  thinking: 'Thinking',
  tool: 'Running tool',
  waiting_input: 'Awaiting input',
  waiting_approval: 'Awaiting approval',
  responding: 'Responding',
} as const;

export function LiveRunHeader() {
  const task = useChatStore((state) => state.getActiveTask());
  const [now, setNow] = useState(() => Date.now());

  const isLive = task?.status === 'running' || task?.status === 'waiting_approval' || task?.status === 'waiting_input';
  const activeRun = task?.activeRun;

  useEffect(() => {
    if (!isLive || !activeRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun, isLive]);

  if (!task || !isLive || !activeRun) {
    return null;
  }

  const threshold = STALLED_THRESHOLDS[activeRun.phase] ?? STALLED_THRESHOLDS.default;
  const isStalled = task.status === 'running' && now - activeRun.lastActivityAt >= threshold;
  const phaseLabel = task.status === 'waiting_input'
    ? phaseLabels.waiting_input
    : task.status === 'waiting_approval'
      ? phaseLabels.waiting_approval
      : isStalled
        ? 'Stalled'
        : phaseLabels[activeRun.phase];

  const isPlan = task.mode === 'plan';
  const toolName = activeRun.activeToolName;
  const agentLabel = formatAgentLabel(task.agentId);

  // Build compact status text: "Working · Glob · 2:27"
  const parts: string[] = [agentLabel, phaseLabel];
  if (toolName) parts.push(toolName);

  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-text-tertiary">
      <Loader2 size={11} className={`animate-spin ${isPlan ? 'text-plan' : 'text-accent'}`} />
      <AgentIcon
        agentId={task.agentId}
        size={11}
        className={AGENT_COLORS[task.agentId] ?? 'text-text-tertiary'}
      />
      <span className="text-text-secondary">{parts.join(' \u00b7 ')}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 size={10} />
        {formatElapsed(now - activeRun.startedAt)}
      </span>
      {isStalled && (
        <button
          className="text-warning hover:text-warning-bright cursor-pointer underline"
          onClick={() => {
            window.api?.invoke('task:restart', { taskId: task.id }).catch(() => {});
          }}
        >
          Stalled — restart
        </button>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatAgentLabel(agentId: string): string {
  switch (agentId) {
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'openai':
      return 'ChatGPT';
    case 'gemini':
      return 'Gemini';
    case 'ollama':
      return 'Ollama';
    default:
      return agentId;
  }
}
