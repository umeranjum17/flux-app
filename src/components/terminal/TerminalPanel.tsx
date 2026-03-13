import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useUiStore } from '../../stores/ui';
import { TerminalTabs, type TerminalTab } from './TerminalTabs';

const DARK_THEME = {
  background: '#181a20',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  selectionBackground: '#3a3f4b',
};

const LIGHT_THEME = {
  background: '#fafaf8',
  foreground: '#1e1e1e',
  cursor: '#1e1e1e',
  selectionBackground: '#add6ff',
};

let termCounter = 0;

export interface TerminalPanelHandle {
  focusActive: () => void;
}

interface TerminalPanelProps {
  visible?: boolean;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ visible = true }, ref) {
    const cwd = useUiStore((s) => s.cwd);
    const appTheme = useUiStore((s) => s.theme);
    const [tabs, setTabs] = useState<TerminalTab[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRefs = useRef<Map<string, { term: any; fitAddon: any }>>(new Map());

    useImperativeHandle(ref, () => ({
      focusActive() {
        if (activeId) {
          const active = terminalRefs.current.get(activeId);
          if (active) active.term.focus();
        }
      },
    }));

    const createTerminal = useCallback(async () => {
      const id = `term-${++termCounter}`;
      const title = `Terminal ${termCounter}`;

      setTabs((prev) => [...prev, { id, title }]);
      setActiveId(id);

      await window.api.invoke('terminal:create', { id, cwd });

      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');

      const currentTheme = useUiStore.getState().theme;
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Cascadia Code", monospace',
        theme: currentTheme === 'dark' ? DARK_THEME : LIGHT_THEME,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      terminalRefs.current.set(id, { term, fitAddon });

      requestAnimationFrame(() => {
        const el = document.getElementById(`terminal-${id}`);
        if (el) {
          term.open(el);
          fitAddon.fit();
          window.api.invoke('terminal:resize', { id, cols: term.cols, rows: term.rows });
        }
      });

      term.onData((data: string) => {
        window.api.invoke('terminal:write', { id, data });
      });

      return id;
    }, [cwd]);

    // Create first terminal on mount
    useEffect(() => {
      if (tabs.length === 0) {
        createTerminal();
      }
    }, []);

    // Listen for terminal data from main process
    useEffect(() => {
      const cleanup = window.api.on('terminal:data', (...args: unknown[]) => {
        const { id, data } = args[0] as { id: string; data: string };
        const termRef = terminalRefs.current.get(id);
        if (termRef) termRef.term.write(data);
      });

      const cleanupExit = window.api.on('terminal:exit', (...args: unknown[]) => {
        const { id } = args[0] as { id: string };
        const termRef = terminalRefs.current.get(id);
        if (termRef) termRef.term.dispose();
        terminalRefs.current.delete(id);
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

    // Refit when becoming visible
    useEffect(() => {
      if (visible && activeId) {
        requestAnimationFrame(() => {
          const termRef = terminalRefs.current.get(activeId);
          if (termRef) termRef.fitAddon.fit();
        });
      }
    }, [visible, activeId]);

    const handleClose = useCallback((id: string) => {
      window.api.invoke('terminal:kill', { id });
      const termRef = terminalRefs.current.get(id);
      if (termRef) termRef.term.dispose();
      terminalRefs.current.delete(id);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id && next.length > 0) setActiveId(next[0].id);
        return next;
      });
    }, [activeId]);

    return (
      <div className={`flex flex-col flex-1 min-h-0 ${visible ? '' : 'hidden'}`}>
        {/* Terminal tabs */}
        <TerminalTabs
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={handleClose}
          onCreate={createTerminal}
        />

        {/* Terminal containers */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              id={`terminal-${tab.id}`}
              className="absolute inset-0"
              style={{ display: tab.id === activeId ? 'block' : 'none' }}
            />
          ))}
        </div>
      </div>
    );
  }
);
