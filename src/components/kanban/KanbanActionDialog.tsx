import { useState, useEffect, useRef } from 'react';
import { X, Search, Map, Code } from 'lucide-react';
import type { KanbanDropAction } from './kanban-phases';
import type { Workspace } from '../../lib/ipc-api';

const ACTION_CONFIG: Record<Exclude<KanbanDropAction, 'review' | 'merge'>, {
  label: string;
  icon: typeof Search;
  placeholder: string;
  submitLabel: string;
  color: string;
}> = {
  discover: {
    label: 'Start Discovery',
    icon: Search,
    placeholder: 'What should the agent research and explore?',
    submitLabel: 'Start Discovery',
    color: 'bg-warning',
  },
  plan: {
    label: 'Start Planning',
    icon: Map,
    placeholder: 'What should the agent plan?',
    submitLabel: 'Start Planning',
    color: 'bg-plan',
  },
  code: {
    label: 'Start Coding',
    icon: Code,
    placeholder: 'What should the agent implement?',
    submitLabel: 'Start Coding',
    color: 'bg-info',
  },
};

interface KanbanActionDialogProps {
  workspace: Workspace;
  action: Exclude<KanbanDropAction, 'review' | 'merge'>;
  onSubmit: (prompt: string) => void;
  onClose: () => void;
}

export function KanbanActionDialog({ workspace, action, onSubmit, onClose }: KanbanActionDialogProps) {
  const config = ACTION_CONFIG[action];
  const Icon = config.icon;
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-primary border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${config.color}/15`}>
              <Icon size={13} className={config.color.replace('bg-', 'text-')} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{config.label}</h3>
              <p className="text-[11px] text-text-tertiary truncate max-w-[280px]">{workspace.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-tertiary">
            <X size={14} />
          </button>
        </div>

        {/* Prompt input */}
        <div className="px-4 py-3">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary/60 outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/20"
          />
          <p className="mt-1.5 text-[10px] text-text-tertiary">
            {'\u2318'}+Enter to submit
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${config.color} hover:opacity-90`}
          >
            {config.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
