import React, { useState, useMemo } from 'react';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  active?: boolean;
}

export function ThinkingBlock({ content, active = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const isExpanded = active || expanded;

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-bg-hover/50 transition-colors"
      >
        <Brain size={13} className={active ? 'text-accent animate-pulse' : 'text-text-tertiary'} />
        {isExpanded ? (
          <ChevronDown size={12} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={12} className="text-text-tertiary" />
        )}
        <span className="text-[12px] text-text-tertiary">
          {active ? 'Thinking...' : `Thinking`}
        </span>
        <span className="text-[11px] text-text-tertiary/60 tabular-nums">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle px-3 py-2.5">
          <div className="text-text-tertiary italic text-[12px] leading-relaxed font-mono whitespace-pre-wrap border-l-2 border-text-tertiary/20 pl-3">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
