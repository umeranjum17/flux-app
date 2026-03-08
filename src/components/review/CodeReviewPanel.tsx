import { ArrowLeft } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { FileChangelist } from './FileChangelist';
import { ReviewDiffViewer } from './ReviewDiffViewer';

export function CodeReviewPanel() {
  const reviewingWorkspaceId = useWorkspaceStore((s) => s.reviewingWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const diffFiles = useWorkspaceStore((s) => s.diffFiles);
  const selectedFile = useWorkspaceStore((s) => s.selectedFile);
  const fileDiff = useWorkspaceStore((s) => s.fileDiff);

  const workspace = reviewingWorkspaceId ? workspaces.get(reviewingWorkspaceId) : null;

  if (!workspace) return null;

  const handleDiscard = async (filePath: string) => {
    if (!reviewingWorkspaceId) return;
    await window.api.invoke('workspace:discard-file', {
      workspaceId: reviewingWorkspaceId,
      filePath,
    });
    useWorkspaceStore.getState().refreshDiffFiles();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-bg-secondary">
        <button
          onClick={() => useWorkspaceStore.getState().closeReview()}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-text-primary">Code Review</span>
        <span className="text-[11px] text-text-tertiary">{workspace.name} ({workspace.branch})</span>
      </div>

      {/* Split: file list + diff viewer */}
      <div className="flex flex-1 min-h-0">
        {/* File list */}
        <div className="w-64 shrink-0 border-r border-border bg-bg-secondary overflow-hidden">
          <FileChangelist
            files={diffFiles}
            selectedFile={selectedFile}
            onSelect={(path) => useWorkspaceStore.getState().selectFile(path)}
            onDiscard={handleDiscard}
          />
        </div>

        {/* Diff viewer */}
        <div className="flex-1 min-w-0">
          {fileDiff && selectedFile ? (
            <ReviewDiffViewer
              oldContent={fileDiff.oldContent}
              newContent={fileDiff.newContent}
              fileName={selectedFile}
              onDiscard={() => handleDiscard(selectedFile)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
              Select a file to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
