import React, { useState, useMemo, lazy, Suspense } from 'react';
import { FileText, ChevronRight, ChevronDown, Download } from 'lucide-react';

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'));

interface FileEditBlockProps {
  diff?: string;
  filePath?: string;
  toolName?: string;
}

function countDiffStats(diff: string): { added: number; removed: number } {
  const lines = diff.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

export function FileEditBlock({ diff, filePath, toolName }: FileEditBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const diffLineCount = diff ? diff.split('\n').length : 0;
  const isLargeDiff = diffLineCount > 50;
  const [showFull, setShowFull] = useState(!isLargeDiff);

  const stats = useMemo(() => (diff ? countDiffStats(diff) : null), [diff]);

  return (
    <div className="rounded-lg bg-bg-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5 text-sm hover:bg-bg-hover transition-colors"
      >
        <FileText size={14} className="text-text-secondary shrink-0" />
        <span className="text-text-primary font-mono text-[13px] truncate flex-1">
          {filePath || 'unknown file'}
        </span>
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="flex items-center gap-1 shrink-0">
            {stats.added > 0 && (
              <span className="bg-success/15 text-success text-xs font-mono px-1.5 py-0.5 rounded">
                +{stats.added}
              </span>
            )}
            {stats.added > 0 && stats.removed > 0 && (
              <span className="text-text-tertiary text-xs">&middot;</span>
            )}
            {stats.removed > 0 && (
              <span className="bg-error/15 text-error text-xs font-mono px-1.5 py-0.5 rounded">
                -{stats.removed}
              </span>
            )}
          </span>
        )}
        <Download size={13} className="text-text-tertiary shrink-0" />
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
        )}
      </button>

      {expanded && diff && (
        <div className="border-t border-border/30 overflow-x-auto">
          {showFull ? (
            <Suspense
              fallback={
                <div className="p-3 text-text-tertiary text-sm">Loading diff...</div>
              }
            >
              <ReactDiffViewer
                oldValue={extractOld(diff)}
                newValue={extractNew(diff)}
                splitView={false}
                useDarkTheme
                styles={{
                  contentText: { fontSize: '13px', fontFamily: 'var(--font-mono)' },
                  diffContainer: { background: 'var(--color-bg-elevated)' },
                }}
              />
            </Suspense>
          ) : (
            <div className="p-3">
              <pre className="text-[13px] font-mono text-text-secondary whitespace-pre-wrap">
                {diff.split('\n').slice(0, 20).join('\n')}
              </pre>
              <button
                onClick={() => setShowFull(true)}
                className="mt-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Show full diff ({diffLineCount} lines)
              </button>
            </div>
          )}
        </div>
      )}

      {expanded && !diff && (
        <div className="border-t border-border/30 px-3 py-2 text-text-tertiary text-sm">
          File modified
          {filePath ? `: ${filePath}` : ''}
        </div>
      )}
    </div>
  );
}

function extractOld(diff: string): string {
  const lines = diff.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
    if (line.startsWith('-')) {
      result.push(line.slice(1));
    } else if (line.startsWith('+')) {
      continue;
    } else {
      result.push(line.startsWith(' ') ? line.slice(1) : line);
    }
  }
  return result.join('\n');
}

function extractNew(diff: string): string {
  const lines = diff.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) {
      result.push(line.slice(1));
    } else if (line.startsWith('-')) {
      continue;
    } else {
      result.push(line.startsWith(' ') ? line.slice(1) : line);
    }
  }
  return result.join('\n');
}
