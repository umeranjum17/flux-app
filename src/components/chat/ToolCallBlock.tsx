import React, { useState } from 'react';
import {
  Terminal,
  FileText,
  FilePen,
  Search,
  Wrench,
  Loader2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface ToolCallBlockProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  content: string;
  isRunning?: boolean;
}

function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes('bash') || name.includes('command') || name.includes('shell')) {
    return { Icon: Terminal, color: 'text-warning' };
  }
  if (name.includes('read') || name.includes('view')) {
    return { Icon: FileText, color: 'text-info' };
  }
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) {
    return { Icon: FilePen, color: 'text-info' };
  }
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('find')) {
    return { Icon: Search, color: 'text-success' };
  }
  return { Icon: Wrench, color: 'text-text-secondary' };
}

function getToolDescription(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return toolName;
  const name = toolName.toLowerCase();

  if (name.includes('bash') && toolInput.command) {
    const cmd = String(toolInput.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if ((name.includes('read') || name.includes('write') || name.includes('edit')) && (toolInput.file_path || toolInput.path)) {
    return String(toolInput.file_path || toolInput.path);
  }
  if (name.includes('grep') && toolInput.pattern) {
    return `/${toolInput.pattern}/`;
  }
  if (name.includes('glob') && toolInput.pattern) {
    return String(toolInput.pattern);
  }
  return toolName;
}

export function ToolCallBlock({
  toolName,
  toolInput,
  toolCallId,
  content,
  isRunning,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { Icon, color } = getToolIcon(toolName);
  const description = getToolDescription(toolName, toolInput);

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-sm"
      >
        {isRunning ? (
          <Loader2 size={14} className={`${color} animate-spin`} />
        ) : (
          <Icon size={14} className={color} />
        )}
        <span className={`font-medium ${color}`}>{toolName}</span>
        <span className="text-text-tertiary truncate flex-1 text-[13px]">
          {description !== toolName ? description : ''}
        </span>
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
        )}
      </button>

      {expanded && toolInput && (
        <pre className="mt-2 bg-bg-elevated rounded-md p-3 text-[13px] font-mono text-text-secondary overflow-x-auto">
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
    </div>
  );
}
