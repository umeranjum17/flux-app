import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useState, useMemo } from 'react';
import { Columns2, AlignJustify, Undo2 } from 'lucide-react';

interface ReviewDiffViewerProps {
  oldContent: string;
  newContent: string;
  fileName: string;
  onDiscard?: () => void;
}

export function ReviewDiffViewer({ oldContent, newContent, fileName, onDiscard }: ReviewDiffViewerProps) {
  const [splitView, setSplitView] = useState(false);

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
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    }),
    [],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
        <span className="text-xs font-mono text-text-secondary truncate">{fileName}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSplitView(false)}
            title="Unified view"
            className={`p-1 rounded ${!splitView ? 'bg-bg-hover text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
          >
            <AlignJustify size={13} />
          </button>
          <button
            onClick={() => setSplitView(true)}
            title="Side-by-side view"
            className={`p-1 rounded ${splitView ? 'bg-bg-hover text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
          >
            <Columns2 size={13} />
          </button>
          {onDiscard && (
            <button
              onClick={onDiscard}
              title="Discard changes to this file"
              className="p-1 rounded text-text-tertiary hover:text-error hover:bg-error/10 transition-colors ml-1"
            >
              <Undo2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Diff */}
      <div className="flex-1 overflow-auto">
        <ReactDiffViewer
          oldValue={oldContent}
          newValue={newContent}
          splitView={splitView}
          useDarkTheme
          compareMethod={DiffMethod.WORDS}
          styles={diffStyles}
        />
      </div>
    </div>
  );
}
