import React from 'react';
import { Copy, GitBranch, Check } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import type { DiffData, DiffFileEntry } from '../../lib/types';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m, ${seconds}s`;
  return `${seconds}s`;
}

function getFileExtension(path: string): string {
  const basename = path.split('/').pop() ?? path;
  return basename.split('.').pop()?.toLowerCase() ?? '';
}

function getBasename(path: string): string {
  return path.split('/').pop() ?? path;
}

function FileTypeIcon({ ext }: { ext: string }) {
  if (ext === 'ts' || ext === 'mts' || ext === 'cts') {
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[14px] rounded-[2px] bg-[#3178c6] text-white text-[8px] font-bold leading-none shrink-0">
        TS
      </span>
    );
  }
  if (ext === 'tsx') {
    return (
      <span className="inline-flex items-center justify-center w-[16px] h-[14px] text-[#61dafb] text-[11px] leading-none shrink-0">
        ⚛
      </span>
    );
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[14px] rounded-[2px] bg-[#f7df1e] text-[#323330] text-[8px] font-bold leading-none shrink-0">
        JS
      </span>
    );
  }
  if (ext === 'jsx') {
    return (
      <span className="inline-flex items-center justify-center w-[16px] h-[14px] text-[#61dafb] text-[11px] leading-none shrink-0">
        ⚛
      </span>
    );
  }
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[14px] rounded-[2px] bg-[#563d7c] text-white text-[8px] font-bold leading-none shrink-0">
        CSS
      </span>
    );
  }
  if (ext === 'json') {
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[14px] rounded-[2px] bg-[#5b5b5b] text-white text-[7px] font-bold leading-none shrink-0">
        { }
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-[18px] h-[14px] rounded-[2px] bg-text-tertiary/20 text-text-secondary text-[8px] font-bold leading-none uppercase shrink-0">
      {ext.slice(0, 3) || '?'}
    </span>
  );
}

function FilePill({ file }: { file: DiffFileEntry }) {
  const basename = getBasename(file.path);
  const ext = getFileExtension(file.path);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-bg-elevated/40 px-2.5 py-1 text-[12px]">
      <FileTypeIcon ext={ext} />
      <span className="text-text-primary font-medium">{basename}</span>
      <span className="text-success text-[11px]">+{file.additions}</span>
      <span className="text-error text-[11px]">-{file.deletions}</span>
    </span>
  );
}

interface TaskFooterProps {
  durationMs?: number;
  diff?: DiffData;
}

export function TaskFooter({ durationMs, diff }: TaskFooterProps) {
  const [copied, setCopied] = React.useState(false);
  const gitBranch = useUiStore((s) => s.gitBranch);

  if (!diff && !durationMs) return null;

  const handleCopy = () => {
    const lines: string[] = [];
    if (diff) {
      for (const file of diff.files) {
        lines.push(`${getBasename(file.path)} +${file.additions} -${file.deletions}`);
      }
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary mt-3">
      {durationMs != null && durationMs > 0 && (
        <span className="font-medium text-text-secondary">{formatDuration(durationMs)}</span>
      )}
      <span className="text-text-tertiary">·</span>
      <button
        onClick={handleCopy}
        className="text-text-tertiary hover:text-text-secondary transition-colors p-0.5"
        title={copied ? 'Copied!' : 'Copy file summary'}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {gitBranch && (
        <button
          className="text-text-tertiary hover:text-text-secondary transition-colors p-0.5"
          title={gitBranch}
          onClick={() => navigator.clipboard.writeText(gitBranch)}
        >
          <GitBranch size={13} />
        </button>
      )}
      {diff && diff.files.length > 0 && (
        <>
          <span className="text-text-tertiary">·</span>
          {diff.files.map((file) => (
            <FilePill key={file.path} file={file} />
          ))}
        </>
      )}
    </div>
  );
}
