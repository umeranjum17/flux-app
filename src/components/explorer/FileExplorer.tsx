import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

// Map file extensions to language names for syntax hint
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

// Basic keyword highlighting per language family
function getKeywords(lang: string): Set<string> {
  const tsKeywords = new Set([
    'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'class', 'extends', 'implements', 'interface', 'type', 'enum', 'namespace',
    'new', 'this', 'super', 'typeof', 'instanceof', 'in', 'of', 'as',
    'async', 'await', 'try', 'catch', 'finally', 'throw',
    'default', 'void', 'null', 'undefined', 'true', 'false',
    'public', 'private', 'protected', 'static', 'readonly', 'abstract',
  ]);

  const pyKeywords = new Set([
    'import', 'from', 'def', 'class', 'return', 'if', 'elif', 'else',
    'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'yield',
    'lambda', 'pass', 'break', 'continue', 'raise', 'and', 'or', 'not',
    'in', 'is', 'None', 'True', 'False', 'self', 'async', 'await',
  ]);

  if (['typescript', 'tsx', 'javascript', 'jsx'].includes(lang)) return tsKeywords;
  if (lang === 'python') return pyKeywords;
  return tsKeywords; // reasonable default
}

interface TokenSpan {
  text: string;
  type: 'keyword' | 'string' | 'comment' | 'number' | 'normal';
}

function tokenizeLine(line: string, keywords: Set<string>): TokenSpan[] {
  const tokens: TokenSpan[] = [];
  let i = 0;

  while (i < line.length) {
    // Comments: // or #
    if ((line[i] === '/' && line[i + 1] === '/') || (line[i] === '#' && (i === 0 || line[i - 1] === ' '))) {
      tokens.push({ text: line.slice(i), type: 'comment' });
      return tokens;
    }

    // Strings
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++;
        j++;
      }
      tokens.push({ text: line.slice(i, j + 1), type: 'string' });
      i = j + 1;
      continue;
    }

    // Numbers
    if (/\d/.test(line[i]) && (i === 0 || /[\s(,=:+\-*/<>[\]{]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d._xXa-fA-F]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), type: 'number' });
      i = j;
      continue;
    }

    // Words (identifiers/keywords)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      tokens.push({ text: word, type: keywords.has(word) ? 'keyword' : 'normal' });
      i = j;
      continue;
    }

    // Other characters
    tokens.push({ text: line[i], type: 'normal' });
    i++;
  }

  return tokens;
}

const typeColors: Record<TokenSpan['type'], string> = {
  keyword: 'text-purple-400',
  string: 'text-green-400',
  comment: 'text-text-tertiary italic',
  number: 'text-orange-400',
  normal: 'text-text-secondary',
};

export function FileExplorer() {
  const activeFile = useUiStore((s) => s.activeFile);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const filePath = activeFile?.path ?? null;

  // Load file content
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    setLoading(true);
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

  if (!filePath) {
    return (
      <div className="flex flex-col w-[400px] min-w-[300px] h-full bg-bg-primary border-l border-border items-center justify-center">
        <p className="text-[11px] text-text-tertiary">Select a file to view</p>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() || filePath;
  const lang = getLang(fileName);
  const keywords = getKeywords(lang);
  const lines = content?.split('\n') ?? [];

  return (
    <div className="flex flex-col w-[400px] min-w-[300px] h-full bg-bg-primary border-l border-border overflow-hidden">
      {/* File header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-medium text-text-primary truncate">{fileName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-tertiary font-mono">{lang}</span>
        </div>
        <button
          onClick={() => {
            setContent(null);
            useUiStore.getState().setActiveFile(null);
            useUiStore.getState().setExplorerOpen(false);
          }}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors shrink-0"
        >
          <X size={12} />
        </button>
      </div>

      {/* Content with line numbers */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-[11px] text-text-tertiary px-4 py-4">Loading...</p>
        ) : content === null ? (
          <p className="text-[11px] text-text-tertiary px-4 py-4">Unable to read file</p>
        ) : (
          <div className="flex text-[12px] font-mono leading-5">
            {/* Line numbers gutter */}
            <div className="flex flex-col items-end px-3 py-2 bg-bg-secondary/50 text-text-tertiary select-none border-r border-border shrink-0">
              {lines.map((_, i) => (
                <span key={i} className="leading-5">{i + 1}</span>
              ))}
            </div>
            {/* Code content */}
            <pre className="flex-1 py-2 px-4 overflow-x-auto">
              {lines.map((line, i) => (
                <div key={i} className="leading-5 hover:bg-bg-hover/50">
                  {tokenizeLine(line, keywords).map((token, j) => (
                    <span key={j} className={typeColors[token.type]}>{token.text}</span>
                  ))}
                  {line.length === 0 && '\n'}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
