import React, { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  active?: boolean;
}

export function ThinkingBlock({ content, active = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = active || expanded;

  const preview = useMemo(() => {
    const firstLine = content.split('\n')[0] ?? '';
    return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
  }, [content]);

  return (
    <div className="tool-call-row group">
      <button
        onClick={() => setExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 py-1 px-1 text-left rounded-md hover:bg-bg-hover/40 transition-colors"
      >
        <span className="shrink-0 flex items-center justify-center w-5 h-5">
          <Brain size={13} className={active ? 'text-text-secondary animate-pulse' : 'text-text-tertiary'} />
        </span>
        <span className="text-[12px] font-medium text-text-tertiary">
          {active ? 'Thinking...' : 'Thinking'}
        </span>
        {!isExpanded && preview && (
          <span className="text-[12px] text-text-tertiary/60 truncate min-w-0">
            {preview}
          </span>
        )}
        <span className="shrink-0 text-text-tertiary/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-7 pr-1 pb-2 pt-1">
              <div className="text-text-tertiary/80 italic text-[12px] leading-relaxed font-mono whitespace-pre-wrap border-l-2 border-text-tertiary/15 pl-3 max-h-60 overflow-y-auto">
                {content}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
