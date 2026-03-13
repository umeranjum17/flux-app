import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';

interface DiffViewerProps {
  oldValue: string;
  newValue: string;
  fileName?: string;
}

const LARGE_DIFF_THRESHOLD = 100;

export function DiffViewer({ oldValue, newValue, fileName }: DiffViewerProps) {
  const lineCount = useMemo(() => {
    const oldLines = oldValue.split('\n').length;
    const newLines = newValue.split('\n').length;
    return Math.max(oldLines, newLines);
  }, [oldValue, newValue]);

  const isLarge = lineCount > LARGE_DIFF_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLarge);

  const diffStyles = useMemo(
    () => ({
      variables: {
        dark: {
          diffViewerBackground: 'var(--color-bg-primary)',
          diffViewerColor: 'var(--color-text-primary)',
          addedBackground: 'rgba(34, 197, 94, 0.1)',
          addedColor: 'var(--color-text-primary)',
          removedBackground: 'rgba(239, 68, 68, 0.1)',
          removedColor: 'var(--color-text-primary)',
          wordAddedBackground: 'rgba(34, 197, 94, 0.25)',
          wordRemovedBackground: 'rgba(239, 68, 68, 0.25)',
          addedGutterBackground: 'rgba(34, 197, 94, 0.15)',
          removedGutterBackground: 'rgba(239, 68, 68, 0.15)',
          gutterBackground: 'var(--color-bg-elevated)',
          gutterBackgroundDark: 'var(--color-bg-elevated)',
          highlightBackground: 'var(--color-bg-hover)',
          highlightGutterBackground: 'var(--color-bg-hover)',
          codeFoldGutterBackground: 'var(--color-bg-elevated)',
          codeFoldBackground: 'var(--color-bg-elevated)',
          emptyLineBackground: 'var(--color-bg-primary)',
          codeFoldContentColor: 'var(--color-text-tertiary)',
        },
      },
      line: {
        fontSize: '13px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Code", monospace',
      },
    }),
    [],
  );

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {fileName && (
        <button
          type="button"
          onClick={() => isLarge && setExpanded(!expanded)}
          className={`flex items-center gap-2 w-full px-3 py-2 bg-bg-elevated border-b border-border text-sm ${
            isLarge ? 'cursor-pointer hover:bg-bg-hover' : 'cursor-default'
          }`}
        >
          {isLarge &&
            (expanded ? (
              <ChevronDown size={14} className="text-text-tertiary" />
            ) : (
              <ChevronRight size={14} className="text-text-tertiary" />
            ))}
          <FileText size={14} className="text-text-tertiary" />
          <span className="font-mono text-text-secondary">{fileName}</span>
          {isLarge && !expanded && (
            <span className="ml-auto text-xs text-text-tertiary">{lineCount} lines</span>
          )}
        </button>
      )}

      {expanded && (
        <ReactDiffViewer
          oldValue={oldValue}
          newValue={newValue}
          splitView={false}
          useDarkTheme
          compareMethod={DiffMethod.WORDS}
          styles={diffStyles}
        />
      )}
    </div>
  );
}
