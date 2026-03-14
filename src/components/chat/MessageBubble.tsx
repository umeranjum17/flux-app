import React, { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClipboardCopy, Check, Paperclip, ClipboardList } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { getHighlighter } from '../../lib/shiki';
import type { FileAttachment } from '../../lib/types';

interface MessageBubbleProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  images?: string[];
  attachments?: FileAttachment[];
  highlightAsPlan?: boolean;
}

export function MessageBubble({ content, role, images, attachments, highlightAsPlan = false }: MessageBubbleProps) {
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  if (role === 'system') {
    return (
      <div className="text-text-tertiary italic text-sm px-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  const isPlanAssistant = highlightAsPlan && role === 'assistant';
  const isActAssistant = role === 'assistant' && !isPlanAssistant;

  return (
    <>
      <div
        className={[
          role === 'user'
            ? 'premium-message-user w-full px-5 py-4'
            : isActAssistant
              ? 'premium-message-assistant w-full px-5 py-4'
              : 'w-full',
          isPlanAssistant ? 'premium-plan-card p-5' : '',
        ].join(' ')}
      >
        {isPlanAssistant && (
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-plan/15 bg-plan/8 px-2 py-0.5 text-[11px] font-medium text-plan">
              <ClipboardList size={11} />
              Plan
            </span>
          </div>
        )}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {images.map((src, i) => (
              <button
                key={i}
                onClick={() => setEnlargedImage(src)}
                className="premium-toolbar-button overflow-hidden rounded-md border border-border/70"
              >
                <img
                  src={src}
                  alt={`Attached ${i + 1}`}
                  className="max-h-24 max-w-40 object-cover transition-transform duration-200 hover:scale-[1.03]"
                />
              </button>
            ))}
          </div>
        )}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((attachment) => (
              <div
                key={`${attachment.path}:${attachment.name}`}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border/75 bg-bg-primary/70 px-2.5 py-1 text-xs text-text-secondary"
              >
                <Paperclip size={12} />
                <span className="truncate max-w-[220px]">{attachment.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`markdown-prose max-w-none text-text-primary ${isPlanAssistant ? 'text-[13px] leading-6' : 'text-[13px] leading-6'}`}>
          <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isBlock = match || (typeof children === 'string' && children.includes('\n'));

              if (isBlock) {
                return (
                  <CodeBlock language={match?.[1]}>
                    {String(children).replace(/\n$/, '')}
                  </CodeBlock>
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
              return <blockquote className="border-l-3 border-accent pl-4 italic text-text-secondary my-2">{children}</blockquote>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
        </div>
      </div>

      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 cursor-pointer"
          onClick={() => setEnlargedImage(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setEnlargedImage(null); }}
        >
          <img
            src={enlargedImage}
            alt="Enlarged"
            className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </>
  );
}

function CodeBlock({ children, language }: { children: string; language?: string }) {
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
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  );
}
