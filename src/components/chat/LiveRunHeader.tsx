import { useEffect, useState } from 'react';
import { Clock3, Wrench, Loader2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

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

  // Build compact status text: "Working · Glob · 2:27"
  const parts: string[] = [phaseLabel];
  if (toolName) parts.push(toolName);

  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-text-tertiary">
      <Loader2 size={11} className={`animate-spin ${isPlan ? 'text-plan' : 'text-accent'}`} />
      <span className="text-text-secondary">{parts.join(' \u00b7 ')}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 size={10} />
        {formatElapsed(now - activeRun.startedAt)}
      </span>
      {isStalled && (
        <span className="text-warning">stalled</span>
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
    default:
      return agentId;
  }
}
