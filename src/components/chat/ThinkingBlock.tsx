import React, { useState, useMemo } from 'react';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => content.split('\n').length, [content]);

  return (
    <div className="rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-text-tertiary italic text-sm hover:text-text-secondary transition-colors"
      >
        <Brain size={14} />
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Thinking... ({lineCount} lines)</span>
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-accent pl-3 text-text-tertiary italic text-sm whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}
