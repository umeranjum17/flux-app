import { useEffect, useRef, useState } from 'react';
import { X, FilePen } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { DiffFile } from '../../lib/ipc-api';
import type { EditedFileEntry } from '../../lib/types';
import { getDisplayPath } from '../../lib/path-utils';

function FileRow({
  entry,
  isActive,
  onClick,
}: {
  entry: EditedFileEntry;
  isActive: boolean;
  onClick: () => void;
}) {
  const { basename, context } = getDisplayPath(entry.filePath);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        isActive
          ? 'bg-accent/10 text-accent'
          : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
      }`}
      title={entry.filePath}
    >
      <FilePen size={12} className="shrink-0 text-info" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium truncate">{basename}</div>
        {context && <div className="text-[10px] text-text-tertiary truncate">{context}/</div>}
      </div>
      <span className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
        {entry.additions > 0 && (
          <span className="text-success">+{entry.additions}</span>
        )}
        {entry.deletions > 0 && (
          <span className="text-error">-{entry.deletions}</span>
        )}
        {entry.additions === 0 && entry.deletions === 0 && (
          <span className="text-text-tertiary">±0</span>
        )}
      </span>
    </button>
  );
}

export function FileActivityPanel({ embedded }: { embedded?: boolean } = {}) {
  const task = useChatStore((s) => s.getActiveTask());
  const scrollToFileEdit = useChatStore((s) => s.scrollToFileEdit);
  const openChangesPanel = useWorkspaceStore((s) => s.openChangesPanel);
  const changesPanelSelectFile = useWorkspaceStore((s) => s.changesPanelSelectFile);
  const panelRef = useRef<HTMLDivElement>(null);
  const [workspaceFallbackFiles, setWorkspaceFallbackFiles] = useState<EditedFileEntry[]>([]);
  const [loadingFallback, setLoadingFallback] = useState(false);

  const editedFiles = task?.editedFiles;
  const trackedFiles = editedFiles ? Array.from(editedFiles.values()) : [];
  const workspaceId = task?.workspaceId ?? null;
  const contextKey = task?.workspaceId ?? task?.id ?? '';
  const files = trackedFiles.length > 0 ? trackedFiles : workspaceFallbackFiles;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId || trackedFiles.length > 0) {
      setWorkspaceFallbackFiles([]);
      setLoadingFallback(false);
      return;
    }

    setLoadingFallback(true);
    window.api.invoke('workspace:diff-files', { workspaceId })
      .then((diffFiles) => {
        if (cancelled) return;
        const now = Date.now();
        setWorkspaceFallbackFiles(
          (diffFiles as DiffFile[]).map((file, index) => ({
            filePath: file.path,
            toolCallId: `workspace-diff-${index}`,
            additions: file.additions,
            deletions: file.deletions,
            timestamp: now - index,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setWorkspaceFallbackFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFallback(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, trackedFiles.length]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const t = useChatStore.getState().getActiveTask();
        const key = t?.workspaceId ?? t?.id;
        if (key) useUiStore.getState().setFileActivityPanelOpen(false, key);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const wrapperClass = embedded
    ? 'flex min-h-0 flex-1 flex-col'
    : 'w-[220px] shrink-0 border-l border-border/50 bg-bg-surface/30 flex flex-col';

  if (files.length === 0) {
    return (
      <div ref={panelRef} className={wrapperClass}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
          <span className="text-[12px] font-medium text-text-secondary">Files</span>
          {!embedded && (
            <button
              onClick={() => contextKey && useUiStore.getState().setFileActivityPanelOpen(false, contextKey)}
              className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-[12px] text-text-tertiary text-center">
            {loadingFallback ? 'Loading files...' : 'No files edited yet'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-text-secondary">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-mono">
            <span className="text-success">+{totalAdditions}</span>
            <span className="text-error">-{totalDeletions}</span>
          </span>
        </div>
        {!embedded && (
          <button
            onClick={() => contextKey && useUiStore.getState().setFileActivityPanelOpen(false, contextKey)}
            className="p-0.5 rounded text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {files
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((entry) => (
            <FileRow
              key={entry.filePath}
              entry={entry}
              isActive={false}
              onClick={async () => {
                // Copilot inline diffs don't render well — open full Changes Panel directly
                const isCopilot = task?.agentId === 'copilot';
                if (!isCopilot) {
                  const didScroll = scrollToFileEdit(entry.toolCallId);
                  if (didScroll || !workspaceId) return;
                }
                if (!workspaceId) return;
                await openChangesPanel(workspaceId);
                await changesPanelSelectFile(entry.filePath);
              }}
            />
          ))}
      </div>
    </div>
  );
}
