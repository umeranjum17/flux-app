import React, { useEffect, useState, useCallback } from 'react';
import { Clock3, Loader2, Square } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';

const STALLED_THRESHOLDS: Record<string, number> = {
  tool: 900_000,
  thinking: 540_000,
  default: 360_000,
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

export const LiveRunHeader = React.memo(function LiveRunHeader() {
  const task = useChatStore((state) => state.getActiveTask());
  const [now, setNow] = useState(() => Date.now());

  const isLive = task?.status === 'running' || task?.status === 'waiting_approval' || task?.status === 'waiting_input';
  const activeRun = task?.activeRun;

  useEffect(() => {
    if (!isLive || !activeRun) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRun, isLive]);

  const handleStop = useCallback(async () => {
    if (!task) return;
    try {
      await window.api.invoke('task:stop', { taskId: task.id });
    } catch {
      // agent:done event handles status transition
    }
  }, [task]);

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
          onClick={() => {
            window.api?.invoke('task:restart', { taskId: task.id }).catch(() => {});
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-warning hover:bg-warning/10 transition-colors"
        >
          <Square size={8} fill="currentColor" />
          stalled — restart
        </button>
      )}
    </div>
  );
});

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
    case 'copilot':
      return 'GitHub Copilot';
    case 'ollama':
      return 'Ollama';
    default:
      return agentId;
  }
}
