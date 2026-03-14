import React from 'react';
import { CheckCircle2 } from 'lucide-react';

interface ResultBlockProps {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  content?: string;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(3)}`;
}

export function ResultBlock({
  costUsd,
  inputTokens,
  outputTokens,
  durationMs,
  content,
}: ResultBlockProps) {
  const parts: string[] = ['Done'];

  if (costUsd != null && costUsd > 0) {
    parts.push(formatCost(costUsd));
  }
  if (inputTokens != null && outputTokens != null) {
    parts.push(`${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out tokens`);
  }
  if (durationMs != null && durationMs > 0) {
    parts.push(formatDuration(durationMs));
  }

  return (
    <div className="mt-2 border-t border-border/35 pt-2">
      <div className="flex items-center gap-2 text-[12px] text-text-secondary">
        <CheckCircle2 size={14} className="shrink-0 text-success/85" />
        <span>{parts.join(' \u00b7 ')}</span>
      </div>
      {content && (
        <p className="mt-1 text-sm text-text-secondary">{content}</p>
      )}
    </div>
  );
}
