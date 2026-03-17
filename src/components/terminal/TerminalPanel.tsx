import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { TerminalTabs, type TerminalTab, type ShellProfile } from './TerminalTabs';

const DARK_THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#000000',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#000000',
  black: '#000000',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#d19a66',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

let termCounter = 0;

export interface TerminalPanelHandle {
  focusActive: () => void;
  openWorkspaceTerminal: (workspaceId: string) => void;
  createTerminal: (opts?: { shell?: string }) => void;
  openRunTerminal: (workspaceId: string, command: string, label: string) => void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle>(
  function TerminalPanel(_props, ref) {
    const cwd = useUiStore((s) => s.cwd);
    const appTheme = useUiStore((s) => s.theme);
    const setActiveTerminalId = useUiStore((s) => s.setActiveTerminalId);
    const setBottomPanelOpen = useUiStore((s) => s.setBottomPanelOpen);
    const [tabs, setTabs] = useState<TerminalTab[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [profiles, setProfiles] = useState<ShellProfile[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRefs = useRef<Map<string, { term: any; fitAddon: any }>>(new Map());
    // Buffer PTY data that arrives before the xterm Terminal instance is ready
    const pendingDataRef = useRef<Map<string, string[]>>(new Map());

    // Load shell profiles
    useEffect(() => {
      window.api.invoke('terminal:get-profiles').then((p) => {
        setProfiles(p as ShellProfile[]);
      }).catch(() => {});
    }, []);

    const createTerminal = useCallback(async (opts?: {
      workspaceId?: string;
      workspaceName?: string;
      workspaceBranch?: string;
      shell?: string;
      command?: string;
    }) => {
      const id = `term-${++termCounter}`;

      // Placeholder title until we get shellName back
      const placeholderTitle = opts?.workspaceName
        ? opts.workspaceName
        : `Terminal ${termCounter}`;

      setTabs((prev) => [...prev, {
        id,
        title: placeholderTitle,
        workspaceId: opts?.workspaceId,
        workspaceBranch: opts?.workspaceBranch,
      }]);
      setActiveId(id);
      setActiveTerminalId(id);

      try {
        const result = await window.api.invoke('terminal:create', {
          id,
          cwd: opts?.workspaceId ? undefined : cwd,
          workspaceId: opts?.workspaceId,
          shell: opts?.shell,
          command: opts?.command,
        }) as { id: string; shellName: string };

        // Update tab with shell info
        setTabs((prev) => prev.map((t) =>
          t.id === id
            ? {
              ...t,
              shellName: result.shellName,
              title: opts?.workspaceName || result.shellName || placeholderTitle,
            }
            : t
        ));

        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        const currentTheme = useUiStore.getState().theme;
        const term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontSize: 13,
          lineHeight: 1.2,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Cascadia Code", monospace',
          theme: currentTheme === 'dark' ? DARK_THEME : LIGHT_THEME,
          scrollback: 10000,
          allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        // Store the ref so the terminal:data listener can start writing to it.
        // xterm buffers writes made before open(), so buffered data will render.
        terminalRefs.current.set(id, { term, fitAddon });

        // Flush any PTY data that arrived before the terminal ref was stored
        const buffered = pendingDataRef.current.get(id);
        if (buffered) {
          for (const chunk of buffered) {
            term.write(chunk);
          }
          pendingDataRef.current.delete(id);
        }

        requestAnimationFrame(() => {
          const el = document.getElementById(`terminal-${id}`);
          if (el) {
            term.open(el);
            fitAddon.fit();
            term.focus();
            window.api.invoke('terminal:resize', { id, cols: term.cols, rows: term.rows });
          }
        });

        term.onData((data: string) => {
          window.api.invoke('terminal:write', { id, data });
        });

        return id;
      } catch (err) {
        console.error('[TerminalPanel] Failed to create terminal:', err);
        pendingDataRef.current.delete(id);
        setTabs((prev) => prev.filter((t) => t.id !== id));
        setActiveId((current) => current === id ? null : current);
        return null;
      }
    }, [cwd]);

    useImperativeHandle(ref, () => ({
      focusActive() {
        if (activeId) {
          const active = terminalRefs.current.get(activeId);
          if (active) active.term.focus();
        }
      },
      openWorkspaceTerminal(workspaceId: string) {
        setBottomPanelOpen(true);
        const existing = tabs.find((t) => t.workspaceId === workspaceId);
        if (existing) {
          setActiveId(existing.id);
          setActiveTerminalId(existing.id);
          const termRef = terminalRefs.current.get(existing.id);
          if (termRef) termRef.term.focus();
          return;
        }
        const workspaces = useWorkspaceStore.getState().workspaces;
        const ws = workspaces.get(workspaceId);
        if (ws) {
          createTerminal({
            workspaceId,
            workspaceName: ws.name,
            workspaceBranch: ws.branch,
          }).catch(() => {});
        }
      },
      createTerminal(opts?: { shell?: string }) {
        setBottomPanelOpen(true);
        createTerminal({ shell: opts?.shell }).catch(() => {});
      },
      openRunTerminal(workspaceId: string, command: string, label: string) {
        setBottomPanelOpen(true);
        createTerminal({
          workspaceId,
          workspaceName: label,
          command,
        }).catch(() => {});
      },
    }), [activeId, tabs, createTerminal, setActiveTerminalId, setBottomPanelOpen]);

    // Create first terminal on mount (or a pending workspace terminal)
    useEffect(() => {
      setActiveTerminalId(activeId);
    }, [activeId, setActiveTerminalId]);

    useEffect(() => {
      if (tabs.length === 0) {
        const pendingWsId = useUiStore.getState().pendingWorkspaceTerminalId;
        if (pendingWsId) {
          useUiStore.getState().setPendingWorkspaceTerminalId(null);
          const workspaces = useWorkspaceStore.getState().workspaces;
          const ws = workspaces.get(pendingWsId);
          if (ws) {
            createTerminal({
              workspaceId: pendingWsId,
              workspaceName: ws.name,
              workspaceBranch: ws.branch,
            }).catch(() => {});
            return;
          }
        }
        createTerminal().catch(() => {});
      }
    }, [tabs.length, createTerminal]);

    // Listen for workspace terminal open requests (when panel is already mounted)
    useEffect(() => {
      const handler = (e: Event) => {
        const { workspaceId } = (e as CustomEvent).detail;
        if (workspaceId && ref && 'current' in ref && ref.current) {
          ref.current.openWorkspaceTerminal(workspaceId);
        }
      };
      window.addEventListener('flux:open-workspace-terminal', handler);
      return () => window.removeEventListener('flux:open-workspace-terminal', handler);
    }, [ref]);

    // Listen for terminal data from main process
    useEffect(() => {
      const cleanup = window.api.on('terminal:data', (...args: unknown[]) => {
        const { id, data } = args[0] as { id: string; data: string };
        const termRef = terminalRefs.current.get(id);
        if (termRef) {
          termRef.term.write(data);
        } else {
          // Buffer data until the xterm Terminal is ready
          const pending = pendingDataRef.current.get(id) ?? [];
          pending.push(data);
          pendingDataRef.current.set(id, pending);
        }
      });

      const cleanupExit = window.api.on('terminal:exit', (...args: unknown[]) => {
        const { id } = args[0] as { id: string };
        const termRef = terminalRefs.current.get(id);
        if (termRef) termRef.term.dispose();
        terminalRefs.current.delete(id);
        pendingDataRef.current.delete(id);
        setTabs((prev) => {
          const next = prev.filter((t) => t.id !== id);
          setActiveId((current) => current === id ? (next[0]?.id ?? null) : current);
          return next;
        });
      });

      return () => {
        cleanup();
        cleanupExit();
      };
    }, []);

    useEffect(() => {
      return () => {
        for (const [id, termRef] of terminalRefs.current) {
          termRef.term.dispose();
          void window.api.invoke('terminal:kill', { id });
        }
        terminalRefs.current.clear();
        pendingDataRef.current.clear();
      };
    }, []);

    // Update terminal theme when app theme changes
    useEffect(() => {
      const theme = appTheme === 'dark' ? DARK_THEME : LIGHT_THEME;
      for (const [, termRef] of terminalRefs.current) {
        termRef.term.options.theme = theme;
      }
    }, [appTheme]);

    // Resize on container size change
    useEffect(() => {
      if (!containerRef.current) return;

      const observer = new ResizeObserver(() => {
        if (activeId) {
          const termRef = terminalRefs.current.get(activeId);
          if (termRef) {
            termRef.fitAddon.fit();
            window.api.invoke('terminal:resize', { id: activeId, cols: termRef.term.cols, rows: termRef.term.rows });
          }
        }
      });

      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, [activeId]);

    // Focus terminal when switching tabs
    useEffect(() => {
      if (activeId) {
        requestAnimationFrame(() => {
          const termRef = terminalRefs.current.get(activeId);
          if (termRef) {
            termRef.fitAddon.fit();
            termRef.term.focus();
          }
        });
      }
    }, [activeId]);

    const handleClose = useCallback((id: string) => {
      window.api.invoke('terminal:kill', { id });
      const termRef = terminalRefs.current.get(id);
      if (termRef) termRef.term.dispose();
      terminalRefs.current.delete(id);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id && next.length > 0) setActiveId(next[next.length - 1].id);
        else if (next.length === 0) setActiveId(null);
        return next;
      });
    }, [activeId]);

    const handleClear = useCallback((id: string) => {
      const termRef = terminalRefs.current.get(id);
      if (termRef) {
        termRef.term.clear();
      }
    }, []);

    const handleRename = useCallback((id: string, name: string) => {
      setTabs((prev) => prev.map((t) => t.id === id ? { ...t, title: name } : t));
    }, []);

    const handleCreate = useCallback((shell?: string) => {
      setBottomPanelOpen(true);
      createTerminal({ shell }).catch(() => {});
    }, [createTerminal, setBottomPanelOpen]);

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Terminal tabs + toolbar */}
        <TerminalTabs
          tabs={tabs}
          activeId={activeId}
          profiles={profiles}
          onSelect={setActiveId}
          onClose={handleClose}
          onCreate={handleCreate}
          onClear={handleClear}
          onRename={handleRename}
        />

        {/* Terminal containers */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative bg-[#1e1e1e] dark:bg-[#1e1e1e]">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              id={`terminal-${tab.id}`}
              className="absolute inset-0 p-0.5"
              style={{ display: tab.id === activeId ? 'block' : 'none' }}
            />
          ))}

          {/* Empty state when no terminals */}
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
);
