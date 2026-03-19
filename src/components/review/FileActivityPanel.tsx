import { useEffect, useRef, useState, useCallback } from 'react';
import { X, FilePen, Undo2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import type { DiffFile, WorkspaceDiffSections } from '../../lib/ipc-api';
import type { EditedFileEntry } from '../../lib/types';
import { getDisplayPath } from '../../lib/path-utils';

type FileScope = 'committed' | 'uncommitted';

interface ActivityFileEntry extends EditedFileEntry {
  scope: FileScope;
}

interface FileSection {
  id: FileScope;
  label: string;
  entries: ActivityFileEntry[];
}

function toActivityEntries(
  files: DiffFile[],
  scope: FileScope,
  trackedByPath: Map<string, EditedFileEntry>,
  idPrefix: string,
): ActivityFileEntry[] {
  const now = Date.now();
  return files.map((file, index) => {
    const tracked = trackedByPath.get(file.path);
    return {
      filePath: file.path,
      toolCallId: tracked?.toolCallId ?? `${idPrefix}-${index}`,
      additions: file.additions,
      deletions: file.deletions,
      timestamp: tracked?.timestamp ?? now - index,
      scope,
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}

function FileRow({
  entry,
  isActive,
  onClick,
  onDiscard,
}: {
  entry: ActivityFileEntry;
  isActive: boolean;
  onClick: () => void;
  onDiscard?: () => void;
}) {
  const { basename, context } = getDisplayPath(entry.filePath);

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
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
      {onDiscard && (
        <button
          onClick={(e) => { e.stopPropagation(); onDiscard(); }}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error hover:bg-error/10 transition-all"
          title="Discard changes"
        >
          <Undo2 size={11} />
        </button>
      )}
    </button>
  );
}

export function FileActivityPanel({ embedded }: { embedded?: boolean } = {}) {
  const task = useChatStore((s) => s.getActiveTask());
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const scrollToFileEdit = useChatStore((s) => s.scrollToFileEdit);
  const openChangesPanel = useWorkspaceStore((s) => s.openChangesPanel);
  const changesPanelSelectFile = useWorkspaceStore((s) => s.changesPanelSelectFile);
  const changesPanelOpen = useWorkspaceStore((s) => s.changesPanelOpen);
  const changesPanelSelectedFile = useWorkspaceStore((s) => s.changesPanelSelectedFile);
  const changesPanelSelectedScope = useWorkspaceStore((s) => s.changesPanelSelectedScope);
  const storeSections = useWorkspaceStore((s) => s.changesPanelSections);
  const panelRef = useRef<HTMLDivElement>(null);
  const [localSections, setLocalSections] = useState<WorkspaceDiffSections | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const taskWorkspaceId = task?.workspaceId ?? null;
  const workspaceId = activeWorkspaceId ?? taskWorkspaceId;
  const useTaskTrackedFiles = !workspaceId || taskWorkspaceId === workspaceId;
  const editedFiles = useTaskTrackedFiles ? task?.editedFiles : undefined;
  const trackedFiles = editedFiles ? Array.from(editedFiles.values()) : [];
  const trackedByPath = new Map(trackedFiles.map((entry) => [entry.filePath, entry]));
  const contextKey = workspaceId ?? task?.id ?? '';
  // Prefer local sections (kept fresh by polling) when available; fall back to store sections
  // during the brief window before the first local fetch completes.
  const workspaceSections = localSections ?? (changesPanelOpen ? storeSections : null);
  const uncommittedEntries = workspaceSections
    ? toActivityEntries(workspaceSections.uncommitted, 'uncommitted', trackedByPath, 'workspace-uncommitted')
    : trackedFiles.map((entry) => ({ ...entry, scope: 'uncommitted' as const }));
  const committedEntries = workspaceSections
    ? toActivityEntries(workspaceSections.committed, 'committed', trackedByPath, 'workspace-committed')
    : [];
  const sections: FileSection[] = [];
  if (uncommittedEntries.length > 0) {
    sections.push({ id: 'uncommitted', label: 'Uncommitted', entries: uncommittedEntries });
  }
  if (committedEntries.length > 0) {
    sections.push({ id: 'committed', label: 'Committed', entries: committedEntries });
  }
  const files = sections.flatMap((section) => section.entries);
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  useEffect(() => {
    let cancelled = false;
    let isInitialLoad = true;

    if (!workspaceId) {
      setLocalSections(null);
      setLoadingFiles(false);
      return;
    }

    async function loadDiffSections() {
      // Only show loading indicator on the initial fetch, not during polls
      if (isInitialLoad) {
        setLoadingFiles(true);
      }
      try {
        const sections = await window.api.invoke('workspace:diff-files-separated', { workspaceId }) as WorkspaceDiffSections;
        if (!cancelled) setLocalSections(sections);
      } catch {
        try {
          const legacyFiles = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
          if (!cancelled) {
            setLocalSections({ committed: [], uncommitted: legacyFiles });
          }
        } catch {
          if (!cancelled) setLocalSections({ committed: [], uncommitted: [] });
        }
      } finally {
        if (!cancelled) {
          setLoadingFiles(false);
          isInitialLoad = false;
        }
      }
    }

    void loadDiffSections();

    // Poll for file changes while the changes panel is open
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (changesPanelOpen) {
      intervalId = setInterval(() => {
        if (!cancelled) void loadDiffSections();
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [workspaceId, changesPanelOpen]);

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

  // Keyboard navigation (up/down) when changes panel is open
  useEffect(() => {
    if (!changesPanelOpen || files.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      e.preventDefault();
      const store = useWorkspaceStore.getState();
      const currentIdx = files.findIndex(
        (f) => f.filePath === store.changesPanelSelectedFile && f.scope === store.changesPanelSelectedScope,
      );
      const len = files.length;
      if (len === 0) return;

      let nextIdx: number;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % len;
      } else {
        nextIdx = currentIdx < 0 ? len - 1 : (currentIdx - 1 + len) % len;
      }
      const next = files[nextIdx];
      store.changesPanelSelectFile(next.filePath, next.scope);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [changesPanelOpen, files]);

  const handleDiscard = useCallback(async (filePath: string) => {
    if (!workspaceId) return;
    await window.api.invoke('workspace:discard-file', { workspaceId, filePath, scope: 'uncommitted' as const });
    useWorkspaceStore.getState().refreshChangesPanelFiles();
    try {
      const latest = await window.api.invoke('workspace:diff-files-separated', { workspaceId }) as WorkspaceDiffSections;
      setLocalSections(latest);
    } catch {
      // Keep current list if refresh fails.
    }
  }, [workspaceId]);

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
            {loadingFiles ? 'Loading files...' : 'No committed or uncommitted changes yet'}
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
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {sections.map((section) => {
          const sectionAdditions = section.entries.reduce((sum, entry) => sum + entry.additions, 0);
          const sectionDeletions = section.entries.reduce((sum, entry) => sum + entry.deletions, 0);

          return (
            <div key={section.id} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text-tertiary flex items-center justify-between">
                <span>{section.label} ({section.entries.length})</span>
                <span className="font-mono normal-case tracking-normal">
                  <span className="text-success">+{sectionAdditions}</span>
                  <span className="text-error ml-1">-{sectionDeletions}</span>
                </span>
              </div>
              <div className="space-y-0.5">
                {section.entries.map((entry) => (
                  <FileRow
                    key={`${section.id}:${entry.filePath}`}
                    entry={entry}
                    isActive={
                      changesPanelOpen &&
                      changesPanelSelectedFile === entry.filePath &&
                      changesPanelSelectedScope === entry.scope
                    }
                    onClick={async () => {
                      if (changesPanelOpen) {
                        await changesPanelSelectFile(entry.filePath, entry.scope);
                        return;
                      }

                      const isCopilot = task?.agentId === 'copilot';
                      if (!isCopilot && entry.scope === 'uncommitted') {
                        const didScroll = scrollToFileEdit(entry.toolCallId);
                        if (didScroll || !workspaceId) return;
                      }
                      if (!workspaceId) return;
                      await openChangesPanel(workspaceId, entry.filePath, entry.scope);
                    }}
                    onDiscard={
                      changesPanelOpen && workspaceId && entry.scope === 'uncommitted'
                        ? () => handleDiscard(entry.filePath)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
