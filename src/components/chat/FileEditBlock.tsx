import React, { useState, lazy, Suspense } from 'react';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'));

interface FileEditBlockProps {
  diff?: string;
  filePath?: string;
  toolName?: string;
}

function getBadge(toolName?: string): { label: string; color: string } {
  if (!toolName) return { label: 'modified', color: 'text-info bg-info/15' };
  const name = toolName.toLowerCase();
  if (name.includes('create') || name.includes('new')) {
    return { label: 'new', color: 'text-success bg-success/15' };
  }
  if (name.includes('delete') || name.includes('remove')) {
    return { label: 'deleted', color: 'text-error bg-error/15' };
  }
  return { label: 'modified', color: 'text-info bg-info/15' };
}

export function FileEditBlock({ diff, filePath, toolName }: FileEditBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const badge = getBadge(toolName);

  const diffLineCount = diff ? diff.split('\n').length : 0;
  const isLargeDiff = diffLineCount > 50;
  const [showFull, setShowFull] = useState(!isLargeDiff);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
        )}
        <FileText size={14} className="text-text-secondary shrink-0" />
        <span className="text-text-primary font-mono text-[13px] truncate flex-1">
          {filePath || 'unknown file'}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.color}`}>
          {badge.label}
        </span>
      </button>

      {expanded && diff && (
        <div className="border-t border-border overflow-x-auto">
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
                className="mt-2 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Show full diff ({diffLineCount} lines)
              </button>
            </div>
          )}
        </div>
      )}

      {expanded && !diff && (
        <div className="border-t border-border px-3 py-2 text-text-tertiary text-sm">
          {badge.label === 'new' ? 'File created' : badge.label === 'deleted' ? 'File deleted' : 'File modified'}
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
