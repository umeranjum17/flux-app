import React from 'react';
import { CheckCircle } from 'lucide-react';

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
    <div className="border-t border-border mt-4 pt-3">
      <div className="flex items-center gap-2 text-text-secondary text-[13px]">
        <CheckCircle size={14} className="text-success shrink-0" />
        <span>{parts.join(' \u00b7 ')}</span>
      </div>
      {content && (
        <p className="text-text-secondary text-sm mt-1">{content}</p>
      )}
    </div>
  );
}
