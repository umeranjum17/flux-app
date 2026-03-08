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
    <div className="rounded-lg">
      <button
        onClick={() => setExpanded(!isExpanded)}
        className="flex items-center gap-2 text-text-tertiary italic text-sm hover:text-text-secondary transition-colors"
      >
        <Brain size={14} />
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Thinking... ({lineCount} lines)</span>
      </button>

      {isExpanded && (
        <div className="mt-2 border-l border-border pl-3 text-text-tertiary italic text-sm whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}
