/**
 * Dedicated terminal IPC handlers — extracted from auxiliary.ts.
 *
 * Owns: PTY lifecycle, SSH terminal fallback, data batching with UTF-8
 * boundary safety, ack-based flow control, resize propagation.
 */
import { ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as pty from 'node-pty';

import { setupShellIntegration, parseShellIntegrationEvents } from './shell-integration';
import {
  extendedEnv,
  resolveSshCommand,
  attachChildStdinErrorHandler,
  safeWriteToChildStdin,
} from '../process-utils';

// ── Types ──────────────────────────────────────────────────────────

export interface TerminalHandlerDeps {
  sendToRenderer: (channel: string, payload: unknown) => boolean;
  activeTerminals: Map<string, ChildProcess>;
  getCurrentCwd: () => string;
  getLocalCwd: () => string;
  getSshHost: () => string | null;
  toRemoteShellPath: (value: string) => string;
  requireFields: (obj: Record<string, unknown>, ...fields: string[]) => void;
  getWorkspacePath: (workspaceId: string) => string | undefined;
}

// ── Data batching buffer with UTF-8 boundary safety ────────────────

const ACK_HIGH_WATERMARK = 100_000;  // pause PTY when unacked chars exceed this
const ACK_LOW_WATERMARK = 50_000;    // resume PTY when unacked drops below this
const BATCH_TIMER_MS = 3;            // max delay before flushing accumulated data

class TerminalDataBuffer {
  private buffers = new Map<string, string>();
  private scheduled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private flush: (id: string, data: string) => void) {}

  push(id: string, data: string): void {
    const existing = this.buffers.get(id);
    this.buffers.set(id, existing ? existing + data : data);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // setImmediate handles burst batching (same tick accumulation)
    setImmediate(() => {
      this.doFlush();
      // Trailing timer catches the tail end of output
      this.timer = setTimeout(() => {
        this.doFlush();
      }, BATCH_TIMER_MS);
    });
  }

  private doFlush(): void {
    this.scheduled = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [id, buf] of this.buffers) {
      if (!buf) continue;
      // Check for incomplete UTF-8 multibyte sequences at the end
      const splitAt = findUtf8SafeBoundary(buf);
      if (splitAt === 0) continue; // entire buffer is an incomplete sequence — wait
      if (splitAt < buf.length) {
        // Hold trailing incomplete bytes for next flush
        this.buffers.set(id, buf.slice(splitAt));
        this.flush(id, buf.slice(0, splitAt));
      } else {
        this.buffers.delete(id);
        this.flush(id, buf);
      }
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.buffers.clear();
  }
}

/**
 * Find the last position in the string where a UTF-8 boundary is safe.
 * In JS strings are UTF-16, so we look for unpaired high surrogates at the end.
 * For Buffer data converted via toString(), incomplete multibyte sequences
 * show up as replacement chars, but node-pty delivers strings directly so
 * we primarily guard against split surrogates.
 */
function findUtf8SafeBoundary(data: string): number {
  if (data.length === 0) return 0;
  const last = data.charCodeAt(data.length - 1);
  // High surrogate without a following low surrogate — incomplete pair
  if (last >= 0xd800 && last <= 0xdbff) {
    return data.length - 1;
  }
  return data.length;
}

// ── Flow control state ─────────────────────────────────────────────

interface FlowState {
  unackedChars: number;
  paused: boolean;
}

// ── Registration ───────────────────────────────────────────────────

export function registerTerminalIpcHandlers(deps: TerminalHandlerDeps): { dispose: () => void } {
  const {
    sendToRenderer,
    activeTerminals,
    getCurrentCwd,
    getLocalCwd,
    getSshHost,
    toRemoteShellPath,
    requireFields,
    getWorkspacePath,
  } = deps;

  const activePtys = new Map<string, pty.IPty>();
  const flowStates = new Map<string, FlowState>();
  const dataBuffer = new TerminalDataBuffer((id, data) => {
    sendToRenderer('terminal:data', { id, data });
    // Track unacked chars for flow control
    const flow = flowStates.get(id);
    if (flow) {
      flow.unackedChars += data.length;
      if (!flow.paused && flow.unackedChars > ACK_HIGH_WATERMARK) {
        const ptyProc = activePtys.get(id);
        if (ptyProc) {
          ptyProc.pause();
          flow.paused = true;
        }
      }
    }
  });

  // ── terminal:ack — renderer acknowledges processed chars ──────

  ipcMain.handle('terminal:ack', async (_event, { id, charCount }: { id: string; charCount: number }) => {
    const flow = flowStates.get(id);
    if (!flow) return;
    flow.unackedChars = Math.max(0, flow.unackedChars - charCount);
    if (flow.paused && flow.unackedChars < ACK_LOW_WATERMARK) {
      const ptyProc = activePtys.get(id);
      if (ptyProc) {
        ptyProc.resume();
        flow.paused = false;
      }
    }
  });

  // ── terminal:create ──────────────────────────────────────────────

  ipcMain.handle('terminal:create', async (_event, { id, cwd: termCwd, workspaceId, shell: requestedShell, command }: { id: string; cwd?: string; workspaceId?: string; shell?: string; command?: string }) => {
    requireFields({ id }, 'id');

    // Resolve cwd: workspace worktree path > explicit cwd > current cwd
    let spawnCwd: string;
    if (workspaceId) {
      const wsPath = getWorkspacePath(workspaceId);
      spawnCwd = wsPath ?? termCwd ?? getCurrentCwd();
    } else {
      spawnCwd = getSshHost() ? getLocalCwd() : (termCwd ?? getCurrentCwd());
    }

    // Initialize flow control state
    flowStates.set(id, { unackedChars: 0, paused: false });

    if (getSshHost()) {
      // SSH: fall back to child_process with pseudo-tty allocation
      const proc = spawn(resolveSshCommand(), ['-tt', getSshHost()!], {
        cwd: getLocalCwd(),
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // cd to workspace worktree path or explicit cwd on the remote host
      const remoteCwd = workspaceId ? spawnCwd : termCwd;
      if (remoteCwd) {
        safeWriteToChildStdin(proc, `cd ${toRemoteShellPath(remoteCwd)}\n`, `terminal:${id}`);
      }
      attachChildStdinErrorHandler(proc, `terminal:${id}`);
      activeTerminals.set(id, proc);

      proc.stdout?.on('data', (data: Buffer) => {
        dataBuffer.push(id, data.toString());
      });
      proc.stderr?.on('data', (data: Buffer) => {
        dataBuffer.push(id, data.toString());
      });
      proc.on('exit', () => {
        activeTerminals.delete(id);
        flowStates.delete(id);
        sendToRenderer('terminal:exit', { id });
      });
      return { id, shellName: 'ssh' };
    }

    // Local: use node-pty for proper PTY support
    let shell: string;
    if (requestedShell && fs.existsSync(requestedShell)) {
      shell = requestedShell;
    } else if (process.platform === 'win32') {
      shell = 'powershell.exe';
    } else {
      const preferred = process.env.SHELL;
      shell = (preferred && fs.existsSync(preferred)) ? preferred : '/bin/sh';
    }

    const shellName = path.basename(shell).replace(/\.exe$/i, '');
    const integration = process.platform === 'win32'
      ? { args: [] as string[], env: {} as Record<string, string> }
      : setupShellIntegration(shell);
    const ptyProcess = pty.spawn(shell, integration.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: spawnCwd,
      env: extendedEnv({ TERM: 'xterm-256color', ...integration.env }) as Record<string, string>,
    });

    activePtys.set(id, ptyProcess);

    ptyProcess.onData((data: string) => {
      dataBuffer.push(id, data);

      // Parse shell integration OSC sequences and emit structured events
      const events = parseShellIntegrationEvents(data);
      for (const event of events) {
        sendToRenderer('terminal:integration', { id, event });
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      activePtys.delete(id);
      flowStates.delete(id);
      sendToRenderer('terminal:exit', { id, exitCode });
    });

    // If a command was provided, write it to the PTY after a short delay
    // so the shell has time to initialize
    if (command) {
      setTimeout(() => {
        ptyProcess.write(command + '\n');
      }, 100);
    }

    return { id, shellName };
  });

  // ── terminal:get-profiles ────────────────────────────────────────

  ipcMain.handle('terminal:get-profiles', async () => {
    const profiles: Array<{ name: string; path: string; icon: string }> = [];
    if (process.platform === 'win32') {
      profiles.push(
        { name: 'PowerShell', path: 'powershell.exe', icon: 'terminal' },
        { name: 'Command Prompt', path: 'cmd.exe', icon: 'terminal' },
      );
      const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
      if (fs.existsSync(gitBash)) {
        profiles.push({ name: 'Git Bash', path: gitBash, icon: 'terminal' });
      }
    } else {
      const shellPaths = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/fish', '/usr/local/bin/fish'];
      for (const sp of shellPaths) {
        if (fs.existsSync(sp)) {
          const name = path.basename(sp);
          profiles.push({ name, path: sp, icon: 'terminal' });
        }
      }
    }
    return profiles;
  });

  // ── terminal:write ───────────────────────────────────────────────

  ipcMain.handle('terminal:write', async (_event, { id, data }: { id: string; data: string }) => {
    const ptyProc = activePtys.get(id);
    if (ptyProc) {
      ptyProc.write(data);
      return;
    }
    // Fallback: legacy child_process terminal (SSH)
    const proc = activeTerminals.get(id);
    if (proc) safeWriteToChildStdin(proc, data, `terminal:${id}`);
  });

  // ── terminal:resize ──────────────────────────────────────────────

  ipcMain.handle('terminal:resize', async (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    const ptyProc = activePtys.get(id);
    if (ptyProc) {
      ptyProc.resize(cols, rows);
      return;
    }
    // Propagate resize to SSH terminals via SIGWINCH
    const proc = activeTerminals.get(id);
    if (proc?.pid) {
      try {
        process.kill(proc.pid, 'SIGWINCH');
      } catch {
        // SSH process may not support SIGWINCH — no-op
      }
    }
  });

  // ── terminal:kill ────────────────────────────────────────────────

  ipcMain.handle('terminal:kill', async (_event, { id }: { id: string }) => {
    const ptyProc = activePtys.get(id);
    if (ptyProc) {
      ptyProc.kill();
      activePtys.delete(id);
      flowStates.delete(id);
      return;
    }
    const proc = activeTerminals.get(id);
    if (proc) {
      proc.kill();
      activeTerminals.delete(id);
      flowStates.delete(id);
    }
  });

  // ── terminal:list ────────────────────────────────────────────────

  ipcMain.handle('terminal:list', async () => {
    const localPtys = Array.from(activePtys.entries()).map(([id, proc]) => ({
      id,
      pid: proc.pid,
      kind: 'pty' as const,
    }));
    const sshTerminals = Array.from(activeTerminals.entries()).map(([id, proc]) => ({
      id,
      pid: proc.pid,
      kind: 'ssh' as const,
    }));
    return [...localPtys, ...sshTerminals];
  });

  return {
    dispose() {
      dataBuffer.dispose();
      for (const [, ptyProc] of activePtys) {
        try { ptyProc.kill(); } catch {}
      }
      activePtys.clear();
      flowStates.clear();
    },
  };
}
