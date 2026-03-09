import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import type { DiffData, DiffFileEntry } from '../../lib/types';

interface DiffBlockProps {
  diff: DiffData;
}

function DiffFileLine({ line }: { line: string }) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return <div className="text-success bg-success/5 px-3">{line}</div>;
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return <div className="text-error bg-error/5 px-3">{line}</div>;
  }
  if (line.startsWith('@@')) {
    return <div className="text-accent/70 bg-accent/5 px-3 font-medium">{line}</div>;
  }
  return <div className="text-text-tertiary px-3">{line}</div>;
}

function DiffFileAccordion({ file }: { file: DiffFileEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover/50 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileCode size={12} className="text-text-tertiary" />
        <span className="font-medium text-text-primary truncate">{file.path}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px]">
          {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-error">-{file.deletions}</span>}
        </span>
      </button>
      {expanded && (
        <pre className="overflow-x-auto text-[11px] font-mono leading-[18px] bg-bg-primary/50 border-t border-border/20">
          {file.hunks.map((hunk, i) => (
            <div key={i}>
              {hunk.lines.map((line, j) => (
                <DiffFileLine key={j} line={line} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function DiffBlock({ diff }: DiffBlockProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-lg border border-border/40 bg-bg-elevated/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-hover/30 transition-colors"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="font-medium text-text-primary">
          {diff.files.length} file{diff.files.length !== 1 ? 's' : ''} changed
        </span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className="text-success">+{diff.totalAdditions}</span>
          <span className="text-error">-{diff.totalDeletions}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-border/30">
          {diff.files.map((file) => (
            <DiffFileAccordion key={file.path} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
