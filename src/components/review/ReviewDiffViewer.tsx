import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useState, useMemo, useEffect, useCallback, createElement } from 'react';
import { Columns2, AlignJustify, Undo2 } from 'lucide-react';
import { getHighlighter } from '../../lib/shiki';
import type { Highlighter } from 'shiki';

function getLangFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', sh: 'bash', bash: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css',
    sql: 'sql', md: 'markdown', toml: 'toml', c: 'c', cpp: 'cpp',
    h: 'c', hpp: 'cpp', java: 'java', rb: 'ruby', php: 'php',
    txt: 'text',
  };
  return map[ext] ?? 'text';
}

function useShikiHighlighter(): Highlighter | null {
  const [hl, setHl] = useState<Highlighter | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((h) => { if (!cancelled) setHl(h); });
    return () => { cancelled = true; };
  }, []);
  return hl;
}

interface ReviewDiffViewerProps {
  oldContent: string;
  newContent: string;
  fileName: string;
  onDiscard?: () => void;
}

export function ReviewDiffViewer({ oldContent, newContent, fileName, onDiscard }: ReviewDiffViewerProps) {
  const [splitView, setSplitView] = useState(false);
  const highlighter = useShikiHighlighter();
  const lang = useMemo(() => getLangFromFileName(fileName), [fileName]);

  const highlightedLines = useMemo(() => {
    if (!highlighter) return null;
    const loadedLangs = highlighter.getLoadedLanguages();
    if (!loadedLangs.includes(lang as never)) return null;

    const cache = new Map<string, string>();
    const highlight = (source: string): string => {
      const cached = cache.get(source);
      if (cached !== undefined) return cached;
      const tokens = highlighter.codeToTokens(source, { lang, theme: 'github-dark' });
      const html = tokens.tokens
        .flat()
        .map((t) => {
          const escaped = t.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return t.color ? `<span style="color:${t.color}">${escaped}</span>` : escaped;
        })
        .join('');
      cache.set(source, html);
      return html;
    };

    return highlight;
  }, [highlighter, lang]);

  const renderContent = useCallback(
    (source: string) => {
      if (!highlightedLines) {
        return createElement('span', null, source);
      }
      const html = highlightedLines(source);
      return createElement('span', { dangerouslySetInnerHTML: { __html: html } });
    },
    [highlightedLines],
  );

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
          renderContent={renderContent}
        />
      </div>
    </div>
  );
}
