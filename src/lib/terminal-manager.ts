/**
 * Terminal instance manager — owns xterm lifecycle (create, mount, dispose, theme, resize).
 * Isolates xterm from React so the logic is testable and reusable.
 */
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';

// ── Theme palettes ──────────────────────────────────────────────────────────

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
} as const;

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
} as const;

export function getTheme(mode: 'dark' | 'light') {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}

// ── Managed terminal ────────────────────────────────────────────────────────

export interface ManagedTerminal {
  id: string;
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  mounted: boolean;
  disposed: boolean;
  /** Ack-based flow control: chars received but not yet processed by xterm */
  _pendingChars: number;
  /** Number of write callbacks received since last ack */
  _ackCounter: number;
}

/** Pending data buffer for terminals that haven't been created yet */
const pendingData = new Map<string, string[]>();

/** All active managed terminals */
const terminals = new Map<string, ManagedTerminal>();

// ── Public API ──────────────────────────────────────────────────────────────

export async function createManagedTerminal(
  id: string,
  theme: 'dark' | 'light',
): Promise<ManagedTerminal> {
  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { WebLinksAddon } = await import('@xterm/addon-web-links');
  const { SearchAddon } = await import('@xterm/addon-search');

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    lineHeight: 1.2,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Cascadia Code", monospace',
    theme: getTheme(theme),
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);

  // WebGL is loaded in mountTerminal after term.open() — it needs a canvas.

  const managed: ManagedTerminal = { id, term, fitAddon, searchAddon, mounted: false, disposed: false, _pendingChars: 0, _ackCounter: 0 };
  terminals.set(id, managed);

  // Flush any pending data
  const buffered = pendingData.get(id);
  if (buffered) {
    for (const chunk of buffered) term.write(chunk);
    pendingData.delete(id);
  }

  // Wire user input to IPC
  term.onData((data: string) => {
    window.api.invoke('terminal:write', { id, data });
  });

  return managed;
}

/**
 * Mount a terminal into a DOM element.
 * Retries up to 10 times to handle React commit timing.
 */
export function mountTerminal(managed: ManagedTerminal, elementId: string): void {
  if (managed.disposed) return;
  const attempt = (n: number) => {
    const el = document.getElementById(elementId);
    if (el) {
      managed.term.open(el);
      managed.fitAddon.fit();
      managed.term.focus();
      managed.mounted = true;

      // Load WebGL renderer now that the canvas exists
      loadWebGl(managed.term);

      window.api.invoke('terminal:resize', {
        id: managed.id,
        cols: managed.term.cols,
        rows: managed.term.rows,
      });
    } else if (n < 10) {
      setTimeout(() => attempt(n + 1), 50);
    } else {
      console.error(`[terminal-manager] DOM element ${elementId} not found after retries`);
      managed.term.write('\r\n\x1b[31m[Terminal failed to mount — DOM element not found]\x1b[0m\r\n');
    }
  };
  requestAnimationFrame(() => attempt(0));
}

async function loadWebGl(term: Terminal): Promise<void> {
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl');
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      // Attempt to recover by loading a fresh WebGL context after a short delay
      setTimeout(() => loadWebGl(term), 500);
    });
    term.loadAddon(webgl);
  } catch {
    // WebGL not available — canvas fallback is automatic
  }
}

export function getTerminal(id: string): ManagedTerminal | undefined {
  return terminals.get(id);
}

export function getAllTerminals(): Map<string, ManagedTerminal> {
  return terminals;
}

/** How often (in write callbacks) we send an ack to the main process */
const ACK_EVERY_N_WRITES = 5;

export function writeToTerminal(id: string, data: string): void {
  const managed = terminals.get(id);
  if (managed) {
    managed._pendingChars += data.length;
    managed.term.write(data, () => {
      managed._pendingChars -= data.length;
      managed._ackCounter++;
      if (managed._ackCounter >= ACK_EVERY_N_WRITES || managed._pendingChars < 50_000) {
        const acked = data.length * managed._ackCounter;
        managed._ackCounter = 0;
        window.api.invoke('terminal:ack', { id, charCount: acked });
      }
    });
  } else {
    const pending = pendingData.get(id) ?? [];
    pending.push(data);
    pendingData.set(id, pending);
  }
}

export function fitTerminal(id: string): { cols: number; rows: number } | null {
  const managed = terminals.get(id);
  if (!managed || managed.disposed) return null;
  managed.fitAddon.fit();
  return { cols: managed.term.cols, rows: managed.term.rows };
}

export function focusTerminal(id: string): void {
  const managed = terminals.get(id);
  if (managed && !managed.disposed) {
    managed.fitAddon.fit();
    managed.term.focus();
  }
}

export function disposeTerminal(id: string): void {
  const managed = terminals.get(id);
  if (managed) {
    managed.disposed = true;
    managed.term.dispose();
    terminals.delete(id);
  }
  pendingData.delete(id);
}

export function disposeAll(): void {
  for (const [id, managed] of terminals) {
    managed.disposed = true;
    managed.term.dispose();
    void window.api.invoke('terminal:kill', { id });
  }
  terminals.clear();
  pendingData.clear();
}

export function setAllTheme(theme: 'dark' | 'light'): void {
  const t = getTheme(theme);
  for (const [, managed] of terminals) {
    managed.term.options.theme = t;
  }
}

export function searchInTerminal(id: string, query: string): boolean {
  const managed = terminals.get(id);
  if (!managed) return false;
  return managed.searchAddon.findNext(query);
}

export function searchPrevInTerminal(id: string, query: string): boolean {
  const managed = terminals.get(id);
  if (!managed) return false;
  return managed.searchAddon.findPrevious(query);
}

export function clearSearch(id: string): void {
  const managed = terminals.get(id);
  if (managed) managed.searchAddon.clearDecorations();
}
