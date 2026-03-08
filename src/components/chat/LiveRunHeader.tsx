import React, { useEffect, useState } from 'react';
import { Bot, Clock3, Wrench } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

const STALLED_AFTER_MS = 15_000;

const phaseLabels = {
  starting: 'Starting',
  progress: 'Working',
  thinking: 'Thinking',
  tool: 'Running tool',
  waiting_input: 'Waiting for input',
  waiting_approval: 'Waiting for approval',
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

  const isStalled = task.status === 'running' && now - activeRun.lastActivityAt >= STALLED_AFTER_MS;
  const phaseLabel = task.status === 'waiting_input'
    ? phaseLabels.waiting_input
    : task.status === 'waiting_approval'
      ? phaseLabels.waiting_approval
      : isStalled
        ? 'Stalled'
        : phaseLabels[activeRun.phase];

  return (
    <div className="mb-3 rounded-xl border border-border/60 bg-bg-secondary/80 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
        <span className="inline-flex items-center gap-2 font-medium text-text-primary">
          <Bot size={15} className="text-accent" />
          {formatAgentLabel(task.agentId)}
        </span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium text-text-primary">
          {phaseLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-xs">
          <Clock3 size={13} />
          {formatElapsed(now - activeRun.startedAt)}
        </span>
        {activeRun.activeToolName && (
          <span className="inline-flex items-center gap-1 text-xs">
            <Wrench size={13} />
            {activeRun.activeToolName}
          </span>
        )}
        {isStalled && (
          <span className="text-xs text-warning">No updates for 15s</span>
        )}
      </div>
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
