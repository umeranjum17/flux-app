import React from 'react';
import type { ParsedHunk, DiffLine } from '../../lib/diff-parser';

interface DiffLinesProps {
  hunks: ParsedHunk[];
  maxHeight?: string;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'hunk-header') {
    return (
      <tr className="bg-accent/5">
        <td className="px-2 py-0.5 text-right text-text-tertiary/40 select-none w-[1%] whitespace-nowrap text-[11px]" />
        <td className="px-2 py-0.5 text-right text-text-tertiary/40 select-none w-[1%] whitespace-nowrap text-[11px]" />
        <td className="px-3 py-0.5 text-accent/60 text-xs italic">{line.content}</td>
      </tr>
    );
  }

  const bg =
    line.type === 'added'
      ? 'bg-success/10'
      : line.type === 'removed'
        ? 'bg-error/10'
        : '';

  const textColor =
    line.type === 'added'
      ? 'text-success'
      : line.type === 'removed'
        ? 'text-error'
        : 'text-text-secondary';

  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <tr className={bg}>
      <td className="px-2 py-0 text-right text-text-tertiary/30 select-none w-[1%] whitespace-nowrap text-[11px]">
        {line.oldLine ?? ''}
      </td>
      <td className="px-2 py-0 text-right text-text-tertiary/30 select-none w-[1%] whitespace-nowrap text-[11px]">
        {line.newLine ?? ''}
      </td>
      <td className={`pl-3 pr-3 py-0 whitespace-pre-wrap ${textColor}`}>
        <span className="select-none opacity-40 inline-block w-4">{prefix}</span>
        {line.content}
      </td>
    </tr>
  );
}

export function DiffLines({ hunks, maxHeight = '24rem' }: DiffLinesProps) {
  if (hunks.length === 0) return null;

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-[13px] font-mono leading-5 border-collapse">
        <tbody>
          {hunks.map((hunk, hi) => (
            <React.Fragment key={hi}>
              {hunk.lines.map((line, li) => (
                <DiffLineRow key={`${hi}-${li}`} line={line} />
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
