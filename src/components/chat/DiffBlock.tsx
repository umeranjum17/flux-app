import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import type { DiffData, DiffFileEntry } from '../../lib/types';
import { diffFileEntryToHunks } from '../../lib/diff-parser';
import { DiffLines } from './DiffLines';

interface DiffBlockProps {
  diff: DiffData;
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
        <div className="border-t border-border/20 bg-bg-primary/50">
          <DiffLines hunks={diffFileEntryToHunks(file)} maxHeight="32rem" />
        </div>
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
