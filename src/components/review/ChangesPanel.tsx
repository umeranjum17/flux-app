import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { ReviewDiffViewer } from './ReviewDiffViewer';

/**
 * ChangesPanel — overlay that shows the diff for the currently selected changed file.
 * The file list lives in WorkspaceSidePanel (PanelActivityTab) so both file activity
 * and review changes share the same sidebar → overlay UX pattern.
 */
export function ChangesPanel() {
  const open = useWorkspaceStore((s) => s.changesPanelOpen);
  const selectedFile = useWorkspaceStore((s) => s.changesPanelSelectedFile);
  const fileDiff = useWorkspaceStore((s) => s.changesPanelFileDiff);
  const workspaceId = useWorkspaceStore((s) => s.changesPanelWorkspaceId);

  const close = useCallback(() => {
    useWorkspaceStore.getState().closeChangesPanel();
  }, []);

  // Auto-open workspace side panel (Activity tab) so the review file list is available
  useEffect(() => {
    if (open && !useUiStore.getState().workspacePanelOpen) {
      useUiStore.getState().openWorkspacePanelTab('activity');
    } else if (open) {
      useUiStore.getState().setWorkspacePanelTab('activity');
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, close]);

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!workspaceId) return;
    await window.api.invoke('workspace:discard-file', { workspaceId, filePath });
    useWorkspaceStore.getState().refreshChangesPanelFiles();
  }, [workspaceId]);

  if (!open || !selectedFile) return null;

  // Relative path from workspace worktree
  const workspace = workspaceId ? useWorkspaceStore.getState().workspaces.get(workspaceId) : null;
  const basePath = workspace?.worktreePath || useUiStore.getState().cwd;
  const displayPath = basePath && selectedFile.startsWith(basePath)
    ? selectedFile.slice(basePath.length + 1)
    : selectedFile;
  const fileDisplayName = selectedFile.split('/').pop() || selectedFile;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg-primary animate-in fade-in duration-150">
      {/* Header bar — matches FileExplorer style */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-text-primary truncate">{fileDisplayName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-tertiary font-mono uppercase">diff</span>
          </div>
          <span className="text-[11px] text-text-tertiary truncate hidden sm:block">{displayPath}</span>
        </div>
        <button
          onClick={close}
          className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Diff content */}
      <div className="flex-1 min-h-0">
        {fileDiff ? (
          <ReviewDiffViewer
            oldContent={fileDiff.oldContent}
            newContent={fileDiff.newContent}
            fileName={selectedFile}
            onDiscard={() => handleDiscard(selectedFile)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
            Loading diff...
          </div>
        )}
      </div>
    </div>
  );
}
