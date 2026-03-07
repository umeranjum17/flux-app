import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ToolResultBlockProps {
  content: string;
  isError?: boolean;
  toolCallId?: string;
}

const MAX_LINES = 10;

export function ToolResultBlock({ content, isError, toolCallId }: ToolResultBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => content.split('\n'), [content]);
  const isTruncated = lines.length > MAX_LINES;
  const displayContent = expanded || !isTruncated
    ? content
    : lines.slice(0, MAX_LINES).join('\n');

  return (
    <div
      className={`rounded-lg bg-bg-elevated p-3 border-l-2 ${
        isError ? 'border-error' : 'border-success'
      }`}
    >
      <pre className="text-[13px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">
        <code>{displayContent}</code>
      </pre>

      {isTruncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {expanded ? (
            <>
              <ChevronDown size={12} />
              Show less
            </>
          ) : (
            <>
              <ChevronRight size={12} />
              Show more ({lines.length - MAX_LINES} more lines)
            </>
          )}
        </button>
      )}
    </div>
  );
}
