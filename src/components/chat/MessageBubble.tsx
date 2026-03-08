import React, { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClipboardCopy, Check, Paperclip } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { getHighlighter } from '../../lib/shiki';
import type { FileAttachment } from '../../lib/types';

interface MessageBubbleProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  images?: string[];
  attachments?: FileAttachment[];
}

export function MessageBubble({ content, role, images, attachments }: MessageBubbleProps) {
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  if (role === 'system') {
    return (
      <div className="text-text-tertiary italic text-sm px-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <>
      <div
        className={
          role === 'user'
            ? 'bg-bg-elevated/80 rounded-lg px-4 py-3 w-full'
            : 'w-full'
        }
      >
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {images.map((src, i) => (
              <button
                key={i}
                onClick={() => setEnlargedImage(src)}
                className="rounded-lg overflow-hidden border border-border hover:border-accent transition-colors"
              >
                <img
                  src={src}
                  alt={`Attached ${i + 1}`}
                  className="max-h-24 max-w-40 object-cover"
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
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-primary px-2 py-1 text-xs text-text-secondary"
              >
                <Paperclip size={12} />
                <span className="truncate max-w-[220px]">{attachment.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className={`prose prose-sm max-w-none text-text-primary ${role === 'assistant' ? 'font-mono text-[13px] leading-relaxed' : ''}`}>
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
                  className="bg-bg-hover rounded px-1.5 py-0.5 font-mono text-[13px]"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre({ children }) {
              return <>{children}</>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
        </div>
      </div>

      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
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
          className="shiki-wrapper rounded-lg overflow-x-auto [&>pre]:p-4 [&>pre]:!bg-bg-elevated [&>pre]:font-mono [&>pre]:text-[13px] [&>pre]:leading-5"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="bg-bg-elevated rounded-lg p-4 font-mono text-[13px] overflow-x-auto">
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
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-bg-hover text-text-secondary hover:text-text-primary"
        aria-label="Copy code"
      >
        {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  );
}
