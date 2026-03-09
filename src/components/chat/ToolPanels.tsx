import React, { useState, useEffect, useMemo } from 'react';
import { FileText, Folder } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { getHighlighter } from '../../lib/shiki';
import { detectLanguage } from '../../lib/lang-detect';
import { parseUnifiedDiff } from '../../lib/diff-parser';
import { DiffLines } from './DiffLines';

interface PanelProps {
  toolInput?: Record<string, unknown>;
  resultContent?: string;
  resultIsError?: boolean;
}

/** Terminal-style panel for bash/command/shell tools. */
export function BashPanel({ toolInput, resultContent, resultIsError }: PanelProps) {
  const command = toolInput?.command ? String(toolInput.command) : null;
  const timeout = toolInput?.timeout ? Number(toolInput.timeout) : null;

  const exitCode = useMemo(() => {
    if (!resultContent) return null;
    const match = resultContent.match(/\bexit(?:\s+code)?[: ]+(-?\d+)\b/i);
    return match ? Number(match[1]) : null;
  }, [resultContent]);

  return (
    <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30 bg-black/20">
      {command && (
        <div className="flex items-center gap-2 px-3 py-2 bg-black/30 border-b border-border/20">
          <span className="text-text-tertiary/60 text-xs select-none">$</span>
          <code className="text-[13px] font-mono text-text-primary flex-1 break-all leading-5">
            {command}
          </code>
          {timeout != null && (
            <span className="text-[10px] text-text-tertiary font-mono">{timeout}ms</span>
          )}
          {exitCode !== null && (
            <span
              className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                exitCode === 0 ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
              }`}
            >
              {exitCode}
            </span>
          )}
        </div>
      )}
      {resultContent && (
        <div className="max-h-80 overflow-auto">
          <pre
            className={`px-3 py-2 text-[13px] font-mono whitespace-pre-wrap leading-5 ${
              resultIsError ? 'text-error/80' : 'text-text-secondary'
            }`}
          >
            {resultContent}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Syntax-highlighted code panel for read/view tools. */
export function ReadPanel({ toolInput, resultContent }: PanelProps) {
  const filePath = String(toolInput?.file_path ?? toolInput?.path ?? '');
  const language = detectLanguage(filePath);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    if (!resultContent) return;
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        const lang = hl.getLoadedLanguages().includes(language) ? language : 'text';
        const html = hl.codeToHtml(resultContent, {
          lang,
          theme: theme === 'dark' ? 'github-dark' : 'github-light',
        });
        setHighlightedHtml(html);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resultContent, language, theme]);

  const lineCount = resultContent ? resultContent.split('\n').length : 0;

  return (
    <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30">
      {filePath && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-bg-primary/50 border-b border-border/20 text-xs">
          <span className="font-mono text-text-secondary truncate">{filePath}</span>
          <span className="text-text-tertiary shrink-0 ml-2">{lineCount} lines</span>
        </div>
      )}
      <div className="max-h-96 overflow-auto">
        {highlightedHtml ? (
          <div
            className="shiki-wrapper [&>pre]:px-3 [&>pre]:py-2 [&>pre]:!bg-bg-primary/40 [&>pre]:font-mono [&>pre]:text-[13px] [&>pre]:leading-5"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className="px-3 py-2 bg-bg-primary/40 font-mono text-[13px] text-text-secondary leading-5 whitespace-pre-wrap">
            {resultContent}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Diff panel for edit/write/patch tools. */
export function EditDiffPanel({ diff, filePath }: { diff?: string; filePath?: string }) {
  const hunks = useMemo(() => (diff ? parseUnifiedDiff(diff) : []), [diff]);

  if (hunks.length === 0) {
    return diff ? (
      <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30">
        <pre className="px-3 py-2 bg-bg-primary/40 font-mono text-[13px] text-text-secondary leading-5 whitespace-pre-wrap">
          {diff}
        </pre>
      </div>
    ) : (
      <div className="mx-3 mb-3 text-sm text-text-tertiary">
        File modified{filePath ? `: ${filePath}` : ''}
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30 bg-bg-primary/30">
      <DiffLines hunks={hunks} maxHeight="24rem" />
    </div>
  );
}

/** Improved grep/search results panel. */
export function SearchPanel({ toolInput, resultContent }: PanelProps) {
  const pattern = toolInput?.pattern ? String(toolInput.pattern) : '';

  const groups = useMemo(() => {
    if (!resultContent) return new Map<string, Array<{ lineNum: string; content: string }>>();
    const map = new Map<string, Array<{ lineNum: string; content: string }>>();
    for (const line of resultContent.split('\n')) {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (!match) continue;
      const [, file, lineNum, content] = match;
      if (!map.has(file)) map.set(file, []);
      map.get(file)!.push({ lineNum, content });
    }
    return map;
  }, [resultContent]);

  if (groups.size === 0) {
    return resultContent ? (
      <div className="mx-3 mb-3 rounded-lg border border-border/30 overflow-hidden">
        <pre className="px-3 py-2 bg-bg-primary/40 font-mono text-[13px] text-text-secondary whitespace-pre-wrap max-h-80 overflow-auto">
          {resultContent}
        </pre>
      </div>
    ) : null;
  }

  return (
    <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30 max-h-96 overflow-auto">
      {Array.from(groups.entries()).map(([file, lines]) => (
        <div key={file}>
          <div className="px-3 py-1.5 bg-bg-primary/50 text-xs font-mono text-text-secondary border-b border-border/20 sticky top-0 z-10">
            {file}
            <span className="text-text-tertiary ml-2">({lines.length})</span>
          </div>
          {lines.slice(0, 20).map((line, i) => (
            <div
              key={i}
              className="flex text-[13px] font-mono border-b border-border/10 last:border-b-0"
            >
              <span className="px-2 py-0.5 text-text-tertiary/40 text-right min-w-[3rem] select-none bg-bg-primary/20 shrink-0">
                {line.lineNum}
              </span>
              <span className="px-3 py-0.5 text-text-secondary whitespace-pre-wrap flex-1 min-w-0">
                {highlightPattern(line.content, pattern)}
              </span>
            </div>
          ))}
          {lines.length > 20 && (
            <div className="px-3 py-1 text-xs text-text-tertiary">
              ...{lines.length - 20} more matches
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** File list panel for glob/find tools. */
export function GlobPanel({ toolInput, resultContent }: PanelProps) {
  const paths = useMemo(() => {
    if (!resultContent) return [];
    try {
      const parsed = JSON.parse(resultContent);
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
    } catch {
      /* fall through */
    }
    return resultContent
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }, [resultContent]);

  if (paths.length === 0) return null;

  return (
    <div className="mx-3 mb-3 rounded-lg overflow-hidden border border-border/30 max-h-80 overflow-auto">
      {paths.map((p) => (
        <div
          key={p}
          className="flex items-center gap-2 px-3 py-1 text-[13px] font-mono text-text-secondary border-b border-border/10 last:border-b-0 hover:bg-bg-hover/30"
        >
          {p.includes('.') ? (
            <FileText size={12} className="text-text-tertiary/50 shrink-0" />
          ) : (
            <Folder size={12} className="text-text-tertiary/50 shrink-0" />
          )}
          <span className="truncate">{p}</span>
        </div>
      ))}
    </div>
  );
}

/** Generic fallback panel with formatted JSON. */
export function GenericPanel({ toolInput, resultContent, resultIsError }: PanelProps) {
  return (
    <div className="mx-3 mb-3 space-y-2">
      {toolInput && Object.keys(toolInput).length > 0 && (
        <div className="rounded-lg border border-border/30 overflow-hidden">
          <div className="px-3 py-1.5 bg-bg-primary/30 border-b border-border/20 text-[11px] text-text-tertiary uppercase tracking-wider">
            Input
          </div>
          <pre className="px-3 py-2 bg-bg-primary/20 text-[13px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>
      )}
      {resultContent && (
        <div
          className={`rounded-lg border overflow-hidden ${
            resultIsError ? 'border-error/30' : 'border-border/30'
          }`}
        >
          <pre
            className={`px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap max-h-80 overflow-auto ${
              resultIsError ? 'bg-error/5 text-error/80' : 'bg-bg-primary/20 text-text-secondary'
            }`}
          >
            {resultContent}
          </pre>
        </div>
      )}
    </div>
  );
}

function highlightPattern(text: string, pattern: string): React.ReactNode {
  if (!pattern) return text;
  try {
    const regex = new RegExp(`(${escapeRegExp(pattern)})`, 'gi');
    const parts = text.split(regex);
    if (parts.length === 1) return text;
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-warning/25 text-text-primary rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  } catch {
    return text;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
