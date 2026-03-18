import { useEffect, useRef, useCallback } from 'react';
import { useUiStore } from '../../stores/ui';
import { useTerminalStore, setupTerminalIpc, setupThemeSync, teardownAllTerminals, type TerminalTab } from '../../stores/terminal';
import { useWorkspaceStore } from '../../stores/workspace';
import { fitTerminal, focusTerminal, searchInTerminal, searchPrevInTerminal, clearSearch } from '../../lib/terminal-manager';
import { TerminalTabs } from './TerminalTabs';
import { TerminalSearchBar } from './TerminalSearchBar';

export function TerminalPanel() {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeId = useTerminalStore((s) => s.activeId);
  const searchOpen = useTerminalStore((s) => s.searchOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  const createTerminal = useTerminalStore((s) => s.createTerminal);
  const closeTerminal = useTerminalStore((s) => s.closeTerminal);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const splitTerminal = useTerminalStore((s) => s.splitTerminal);
  const setSplitSize = useTerminalStore((s) => s.setSplitSize);
  const closeSplit = useTerminalStore((s) => s.closeSplit);

  // Set up IPC listeners and theme sync once
  useEffect(() => {
    const cleanupIpc = setupTerminalIpc();
    const cleanupTheme = setupThemeSync();
    return () => {
      cleanupIpc();
      cleanupTheme();
      teardownAllTerminals();
    };
  }, []);

  // Create first terminal on mount (or pending workspace terminal)
  useEffect(() => {
    if (tabs.length > 0) return;
    const pendingWsId = useUiStore.getState().pendingWorkspaceTerminalId;
    if (pendingWsId) {
      useUiStore.getState().setPendingWorkspaceTerminalId(null);
      const ws = useWorkspaceStore.getState().workspaces.get(pendingWsId);
      if (ws) {
        createTerminal({ workspaceId: pendingWsId, workspaceName: ws.name, workspaceBranch: ws.branch }).catch(() => {});
        return;
      }
    }
    createTerminal().catch(() => {});
  }, [tabs.length, createTerminal]);

  // Listen for workspace terminal open requests
  useEffect(() => {
    const handler = (e: Event) => {
      const { workspaceId } = (e as CustomEvent).detail;
      if (workspaceId) useTerminalStore.getState().openWorkspaceTerminal(workspaceId);
    };
    window.addEventListener('flux:open-workspace-terminal', handler);
    return () => window.removeEventListener('flux:open-workspace-terminal', handler);
  }, []);

  // Resize terminals on container size change (debounced to avoid IPC spam during drag)
  useEffect(() => {
    if (!containerRef.current) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const id = useTerminalStore.getState().activeId;
        if (!id) return;
        const dims = fitTerminal(id);
        if (dims) window.api.invoke('terminal:resize', { id, ...dims });

        // Also fit any split panes
        const tab = useTerminalStore.getState().tabs.find((t) => t.id === id || t.splits?.some((s) => s.terminalId === id));
        if (tab?.splits) {
          for (const split of tab.splits) {
            if (split.terminalId !== id) {
              const d = fitTerminal(split.terminalId);
              if (d) window.api.invoke('terminal:resize', { id: split.terminalId, ...d });
            }
          }
        }
      }, 100);
    });
    observer.observe(containerRef.current);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, []);

  // Focus terminal when switching tabs
  useEffect(() => {
    if (activeId) requestAnimationFrame(() => focusTerminal(activeId));
  }, [activeId]);

  // Sync activeTerminalId to ui store
  useEffect(() => {
    useUiStore.getState().setActiveTerminalId(activeId);
  }, [activeId]);

  const handleCreate = useCallback(() => {
    useUiStore.getState().setBottomPanelOpen(true);
    createTerminal().catch(() => {});
  }, [createTerminal]);

  const handleSplit = useCallback(() => {
    splitTerminal().catch(() => {});
  }, [splitTerminal]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TerminalTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveTab}
        onClose={closeTerminal}
        onCreate={handleCreate}
        onSplit={handleSplit}
      />

      {searchOpen && <TerminalSearchBar />}

      <div ref={containerRef} className="flex-1 overflow-hidden relative bg-[#1e1e1e] dark:bg-[#1e1e1e]">
        {tabs.map((tab) => (
          <TerminalContainer
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeId || tab.splits?.some((s) => s.terminalId === activeId) === true}
            activeId={activeId}
            onSplitResize={(index, size) => setSplitSize(tab.id, index, size)}
            onCloseSplit={(termId) => closeSplit(tab.id, termId)}
          />
        ))}

        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <button
              onClick={() => createTerminal().catch(() => {})}
              className="flex items-center gap-2 px-4 py-2 text-xs text-text-tertiary hover:text-text-primary bg-bg-hover/50 hover:bg-bg-hover rounded-md transition-colors"
            >
              <span className="text-base">+</span>
              Create Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Split-aware terminal container ──────────────────────────────────────────

function TerminalContainer({
  tab,
  isActive,
  activeId,
  onSplitResize,
  onCloseSplit,
}: {
  tab: TerminalTab;
  isActive: boolean;
  activeId: string | null;
  onSplitResize: (index: number, size: number) => void;
  onCloseSplit: (termId: string) => void;
}) {
  const splitContainerRef = useRef<HTMLDivElement>(null);

  if (!tab.splits) {
    // Single pane
    return (
      <div
        id={`terminal-${tab.id}`}
        className="absolute inset-0 p-0.5"
        style={{ display: isActive ? 'block' : 'none' }}
      />
    );
  }

  // Split panes
  return (
    <div
      ref={splitContainerRef}
      className="absolute inset-0 flex"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      {tab.splits.map((split, i) => (
        <div key={split.terminalId} className="flex" style={{ width: `${split.size * 100}%`, position: 'relative' }}>
          <div
            id={`terminal-${split.terminalId}`}
            className="flex-1 p-0.5"
            onClick={() => useTerminalStore.getState().setActiveTab(split.terminalId)}
          />
          {i < tab.splits!.length - 1 && (
            <SplitDivider
              onDrag={(delta) => {
                const container = splitContainerRef.current;
                if (!container) return;
                const totalWidth = container.offsetWidth;
                const newSize = Math.max(0.15, Math.min(0.85, split.size + delta / totalWidth));
                onSplitResize(i, newSize);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Split divider ───────────────────────────────────────────────────────────

function SplitDivider({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - lastX;
      lastX = ev.clientX;
      onDrag(delta);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onDrag]);

  return (
    <div
      className="w-[3px] cursor-col-resize bg-border/30 hover:bg-accent/50 transition-colors shrink-0"
      onMouseDown={handleMouseDown}
    />
  );
}
