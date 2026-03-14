import React, { useState } from 'react';
import type { ParsedHunk, DiffLine } from '../../lib/diff-parser';

interface DiffLinesProps {
  hunks: ParsedHunk[];
  maxHeight?: string;
  maxLines?: number;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk-header') {
    return (
      <tr className="bg-bg-hover/50">
        <td className="px-1.5 py-0.5 text-right text-text-tertiary/40 select-none w-[1%] whitespace-nowrap text-[11px]" />
        <td className="px-1.5 py-0.5 text-right text-text-tertiary/40 select-none w-[1%] whitespace-nowrap text-[11px]" />
        <td className="w-[1px] px-1 select-none" />
        <td className="px-2 py-0.5 text-text-tertiary text-xs italic">{line.content}</td>
      </tr>
    );
  }

  const bg =
    line.type === 'added'
      ? 'bg-success/8'
      : line.type === 'removed'
        ? 'bg-error/8'
        : '';

  const gutterBg =
    line.type === 'added'
      ? 'bg-success/15'
      : line.type === 'removed'
        ? 'bg-error/15'
        : 'bg-bg-elevated/50';

  const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
  const markerColor =
    line.type === 'added'
      ? 'text-success'
      : line.type === 'removed'
        ? 'text-error'
        : 'text-text-tertiary';

  return (
    <tr className={bg}>
      <td className={`${gutterBg} px-1.5 py-0 text-right text-text-tertiary/50 select-none w-[1%] whitespace-nowrap text-[11px]`}>
        {line.oldLine ?? ''}
      </td>
      <td className={`${gutterBg} px-1.5 py-0 text-right text-text-tertiary/50 select-none w-[1%] whitespace-nowrap text-[11px] border-r border-border/15`}>
        {line.newLine ?? ''}
      </td>
      <td className={`${markerColor} w-[1px] px-1 py-0 select-none align-top`}>
        {marker}
      </td>
      <td className={`px-2 py-0 whitespace-pre-wrap ${line.type === 'context' ? 'text-text-tertiary' : 'text-text-primary'}`}>
        {line.content}
      </td>
    </tr>
  );
}

export function DiffLines({ hunks, maxHeight = '24rem', maxLines }: DiffLinesProps) {
  const [showAll, setShowAll] = useState(false);

  if (hunks.length === 0) return null;

  const allLines = hunks.flatMap((h) => h.lines);
  const isTruncated = !!(maxLines && allLines.length > maxLines && !showAll);

  return (
    <div className="overflow-auto" style={{ maxHeight: showAll ? 'none' : maxHeight }}>
      <table className="w-full text-[13px] font-mono leading-5 border-collapse">
        <tbody>
          {hunks.map((hunk, hi) => {
            const lines = isTruncated
              ? hunk.lines.slice(0, Math.max(0, maxLines! - hunks.slice(0, hi).reduce((n, h) => n + h.lines.length, 0)))
              : hunk.lines;
            if (lines.length === 0) return null;
            return (
              <React.Fragment key={hi}>
                {lines.map((line, li) => (
                  <DiffLineRow key={`${hi}-${li}`} line={line} />
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {isTruncated && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center py-1.5 text-xs text-text-secondary hover:text-text-primary bg-bg-primary/50 border-t border-border/20"
        >
          Show all ({allLines.length} lines)
        </button>
      )}
    </div>
  );
}
