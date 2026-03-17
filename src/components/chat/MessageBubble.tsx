import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Paperclip, ClipboardList } from 'lucide-react';
import { markdownComponents } from './MarkdownComponents';
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

  const hasMedia = (images && images.length > 0) || (attachments && attachments.length > 0);
  if (!content.trim() && !hasMedia) return null;

  if (role === 'system') {
    return (
      <div className="markdown-prose px-1 text-sm italic text-text-tertiary">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
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
            ? 'premium-message-user w-full px-4 py-3.5'
            : isActAssistant
              ? 'premium-message-assistant w-full px-4 py-3.5'
              : 'w-full',
          isPlanAssistant ? 'premium-plan-card p-4' : '',
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
                className="inline-flex max-w-[320px] items-start gap-1.5 rounded-sm border border-border/75 bg-bg-primary/70 px-2.5 py-1.5 text-xs text-text-secondary"
                title={attachment.path}
              >
                <Paperclip size={12} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate max-w-[220px] text-text-primary">{attachment.name}</span>
                  <span className="block truncate max-w-[220px] text-[10px] text-text-tertiary">{attachment.path}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="markdown-prose max-w-none text-text-primary text-[14px] leading-relaxed">
          <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
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
