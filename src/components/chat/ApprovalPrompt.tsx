import React, { useEffect, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

interface ApprovalPromptProps {
  requestId: string;
  toolName: string;
  description: string;
  action?: string;
  path?: string;
  taskId: string;
}

export function ApprovalPrompt({
  requestId,
  toolName,
  description,
  action,
  path,
  taskId,
}: ApprovalPromptProps) {
  const handleAllow = useCallback(() => {
    useChatStore.getState().setPendingApproval(taskId, null);
    window.api.invoke('task:approve', { taskId, requestId });
  }, [taskId, requestId]);

  const handleDeny = useCallback(() => {
    useChatStore.getState().setPendingApproval(taskId, null);
    window.api.invoke('task:deny', { taskId, requestId });
  }, [taskId, requestId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleAllow();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleDeny();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleAllow, handleDeny]);

  return (
    <div className="border border-warning/30 rounded-xl p-4 bg-bg-elevated shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-1.5 rounded-lg bg-warning/10 shrink-0 mt-0.5">
          <ShieldAlert size={16} className="text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-text-primary font-semibold text-[13px]">
            Permission required
          </h4>
          <p className="text-text-secondary text-[13px] mt-1">
            <span className="font-mono text-[12px] text-warning bg-warning/8 px-1.5 py-0.5 rounded">{toolName}</span>
            {action && <span className="ml-1.5">wants to {action}</span>}
          </p>
          {description && (
            <p className="text-text-secondary text-[12px] mt-1.5 leading-relaxed">{description}</p>
          )}
          {path && (
            <p className="text-text-tertiary text-[11px] font-mono mt-1.5 truncate bg-bg-primary/50 rounded px-2 py-1">
              {path}
            </p>
          )}

          <div className="flex items-center gap-2 mt-3.5">
            <button
              onClick={handleAllow}
              className="bg-accent text-white rounded-lg px-4 py-1.5 text-[12px] font-medium hover:bg-accent-hover transition-colors shadow-sm"
            >
              Allow
              <kbd className="ml-1.5 text-[10px] opacity-70 font-mono">y</kbd>
            </button>
            <button
              onClick={handleDeny}
              className="border border-border rounded-lg px-4 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              Deny
              <kbd className="ml-1.5 text-[10px] opacity-50 font-mono">n</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
