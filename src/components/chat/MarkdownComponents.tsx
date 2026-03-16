import React, { useState, useCallback, useEffect } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { getHighlighter } from '../../lib/shiki';
import type { Components } from 'react-markdown';
import { MermaidBlock } from './MermaidBlock';

export function CodeBlock({ children, language }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      const lang = language && highlighter.getLoadedLanguages().includes(language) ? language : 'text';
      const html = highlighter.codeToHtml(children, {
        lang,
        theme: theme === 'dark' ? 'github-dark' : 'github-light',
      });
      setHighlightedHtml(html);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [children, language, theme]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="group relative my-2">
      {highlightedHtml ? (
        <div
          className="premium-panel shiki-wrapper overflow-x-auto rounded-lg [&>pre]:p-4 [&>pre]:!bg-transparent [&>pre]:font-mono [&>pre]:text-[13px] [&>pre]:leading-5"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="premium-panel overflow-x-auto rounded-lg p-4 font-mono text-[13px]">
          <code className={language ? `language-${language}` : undefined}>
            {children}
          </code>
        </pre>
      )}
      {language && (
        <span className="absolute top-2 left-3 text-[9px] text-text-tertiary uppercase tracking-wider opacity-20">
          {language}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="premium-toolbar-button absolute top-2 right-2 rounded-lg p-1.5 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Copy code"
        title={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  );
}

export const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-([A-Za-z0-9_-]+)/.exec(className || '');
    const content = String(children).replace(/\n$/, '');
    const language = match?.[1]?.toLowerCase();
    const isBlock = Boolean(match) || content.includes('\n');

    if (isBlock) {
      if (language === 'mermaid') {
        return <MermaidBlock code={content} />;
      }

      return (
        <CodeBlock language={language}>{content}</CodeBlock>
      );
    }

    return (
      <code
        className="rounded-lg border border-border/70 bg-bg-hover/80 px-1.5 py-0.5 font-mono text-[13px]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  h1({ children }) {
    return <h1 className="text-xl font-bold font-sans mt-5 mb-2">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-semibold font-sans mt-4 mb-1.5">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold font-sans mt-3 mb-1">{children}</h3>;
  },
  ul({ children }) {
    return <ul className="list-disc pl-6 my-1.5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-6 my-1.5">{children}</ol>;
  },
  blockquote({ children }) {
    return <blockquote className="border-l-3 border-border-focus pl-4 italic text-text-secondary my-2">{children}</blockquote>;
  },
};
