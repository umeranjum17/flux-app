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
    <div className="border border-warning/40 rounded-lg p-4 bg-bg-elevated">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="text-warning shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-text-primary font-medium text-sm">
            Permission required
          </h4>
          <p className="text-text-secondary text-sm mt-1">
            <span className="font-mono text-warning">{toolName}</span>
            {action && <span> wants to {action}</span>}
          </p>
          <p className="text-text-secondary text-sm mt-1">{description}</p>
          {path && (
            <p className="text-text-tertiary text-[13px] font-mono mt-1 truncate">
              {path}
            </p>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleAllow}
              className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Allow (y)
            </button>
            <button
              onClick={handleDeny}
              className="border border-border rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Deny (n)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
