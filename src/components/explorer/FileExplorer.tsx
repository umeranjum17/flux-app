import { useState, useEffect, useCallback } from 'react';
import { X, Copy, Check, FileCode2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { getHighlighter } from '../../lib/shiki';

function getLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    css: 'css', scss: 'scss', html: 'html', vue: 'vue', svelte: 'svelte',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', graphql: 'graphql', prisma: 'prisma',
    dockerfile: 'docker', makefile: 'make',
  };
  return map[ext] || ext || 'text';
}

export function FileExplorer() {
  const activeFile = useUiStore((s) => s.activeFile);
  const theme = useUiStore((s) => s.theme);
  const [content, setContent] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const filePath = activeFile?.path ?? null;

  const close = useCallback(() => {
    setContent(null);
    setHighlightedHtml(null);
    useUiStore.getState().setActiveFile(null);
    useUiStore.getState().setExplorerOpen(false);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [close]);

  // Load file content
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setLoading(true);
    setHighlightedHtml(null);
    (async () => {
      try {
        const result = await window.api.invoke('fs:read', { filePath }) as { content: string | null };
        if (!cancelled) setContent(result.content);
      } catch {
        if (!cancelled) setContent(null);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  // Syntax highlight with shiki
  useEffect(() => {
    if (!content || !filePath) return;
    let cancelled = false;
    const fileName = filePath.split('/').pop() || filePath;
    const lang = getLang(fileName);

    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      const loadedLangs = highlighter.getLoadedLanguages();
      const resolvedLang = loadedLangs.includes(lang) ? lang : 'text';
      const html = highlighter.codeToHtml(content, {
        lang: resolvedLang,
        theme: theme === 'dark' ? 'github-dark' : 'github-light',
      });
      if (!cancelled) setHighlightedHtml(html);
    });

    return () => { cancelled = true; };
  }, [content, filePath, theme]);

  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  if (!filePath) {
    return (
      <div className="flex flex-col w-[400px] min-w-[300px] h-full bg-bg-primary border-l border-border items-center justify-center">
        <p className="text-[11px] text-text-tertiary">Select a file to view</p>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;
  const lang = getLang(fileName);
  const lineCount = content?.split('\n').length ?? 0;

  // Relative path from workspace worktree or global cwd
  const wsId = useWorkspaceStore.getState().activeWorkspaceId;
  const wsPath = wsId ? useWorkspaceStore.getState().workspaces.get(wsId)?.worktreePath : null;
  const basePath = wsPath || useUiStore.getState().cwd;
  const displayPath = basePath && filePath.startsWith(basePath)
    ? filePath.slice(basePath.length + 1)
    : filePath;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-primary animate-in fade-in duration-150">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <FileCode2 size={14} className="text-text-secondary shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-text-primary truncate">{fileName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-tertiary font-mono uppercase">{lang}</span>
          </div>
          <span className="text-[11px] text-text-tertiary truncate hidden sm:block">{displayPath}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-text-tertiary mr-2">{lineCount} lines</span>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Copy file contents"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
          </button>
          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[12px] text-text-tertiary">Loading...</p>
          </div>
        ) : content === null ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[12px] text-text-tertiary">Unable to read file</p>
          </div>
        ) : highlightedHtml ? (
          <div
            className="file-viewer-code overflow-x-auto [&>pre]:p-4 [&>pre]:!bg-transparent [&>pre]:font-mono [&>pre]:text-[13px] [&>pre]:leading-6"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          /* Fallback while shiki loads */
          <pre className="p-4 font-mono text-[13px] leading-6 text-text-secondary overflow-x-auto whitespace-pre">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
