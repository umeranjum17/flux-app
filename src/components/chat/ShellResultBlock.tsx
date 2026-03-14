import { useState } from 'react';
import { CheckCircle, XCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface ShellResultBlockProps {
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

const MAX_VISIBLE_LINES = 10;

function CollapsibleOutput({ content, isError }: { content: string; isError?: boolean }) {
  const lines = content.split('\n');
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? lines : lines.slice(0, MAX_VISIBLE_LINES);
  const truncated = lines.length > MAX_VISIBLE_LINES;

  return (
    <div className={`mt-2 rounded-md p-2 font-mono text-xs ${isError ? 'bg-error/10 text-error' : 'bg-bg-primary/70 text-text-secondary'}`}>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all">
        {visible.join('\n')}
      </pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? 'Show less' : `Show ${lines.length - MAX_VISIBLE_LINES} more lines`}
        </button>
      )}
    </div>
  );
}

export function ShellResultBlock({ command, exitCode, stdout, stderr, durationMs }: ShellResultBlockProps) {
  const success = exitCode === 0;

  return (
    <div className="premium-panel rounded-lg border border-border/60 p-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {success
            ? <CheckCircle size={14} className="shrink-0 text-success" />
            : <XCircle size={14} className="shrink-0 text-error" />
          }
          <span className="font-mono text-xs text-text-primary truncate">$ {command ?? ''}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof exitCode === 'number' && exitCode !== 0 && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-error/15 text-error">
              exit {exitCode}
            </span>
          )}
          {typeof durationMs === 'number' && (
            <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <Clock size={10} />
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </div>

      {/* stdout */}
      {stdout && stdout.trim() && <CollapsibleOutput content={stdout.trim()} />}

      {/* stderr */}
      {stderr && stderr.trim() && <CollapsibleOutput content={stderr.trim()} isError />}
    </div>
  );
}
