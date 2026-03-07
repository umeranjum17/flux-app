import { useState, useCallback } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="relative group bg-bg-elevated rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        {language && (
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
            {language}
          </span>
        )}
        {!language && <span />}
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} className="text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <ClipboardCopy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="font-mono text-[13px] leading-relaxed text-text-primary">{code}</code>
      </pre>
    </div>
  );
}
