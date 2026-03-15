import { ipcMain, BrowserWindow, dialog } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

import { agentManager } from '../agents/manager';
import type { AgentHandle } from '../agents/types';
import type { SdkAgentHandle } from '../agents/claude-sdk';
import { ConfigManager } from '../config/config';
import type { RepoMapConfig } from '../config/types';
import { WorkspaceStore } from '../worktree/store';
import type { WorkspaceStatus } from '../worktree/types';
import { SessionStore } from '../session/store';
import { UsageTracker } from '../usage/tracker';
import { LiveUsageService } from '../usage/live';
import { setSshHost as setToolsSshHost } from '../tools/ssh';
import { grepFiles } from '../tools/grep';
import { repoMapService } from '../intelligence/repomap';
import {
  extendedEnv,
  resolveSshCommand,
  classifySpawnError,
  attachChildStdinErrorHandler,
  safeWriteToChildStdin,
} from '../process-utils';
import { executeBash } from '../tools/bash';
import { suggestCompletion, availableCompletionProviders } from '../completion/service';
import { getCheckpointDiff, listCheckpoints, revertToCheckpoint } from '../checkpoint/manager';

const execFileAsync = promisify(execFile);

type RateLimitInfo = {
  providerId: 'claude-code' | 'codex';
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt: number;
  rateLimitType: string;
  utilization: number;
  overageStatus?: string;
  overageResetsAt?: number;
  fetchedAt?: number;
};

type AuxiliaryIpcDeps = {
  mainWindow: BrowserWindow;
  sessionStore: SessionStore;
  configManager: ConfigManager;
  usageTracker: UsageTracker;
  liveUsageService: LiveUsageService;
  workspaceStore: WorkspaceStore;
  sendToRenderer: (channel: string, payload: unknown) => boolean;
  emitWorkspaceStatus: (workspaceId: string, status: WorkspaceStatus) => void;
  activeTasks: Map<string, AgentHandle>;
  activeTerminals: Map<string, ChildProcess>;
  cachedRateLimits: Map<string, RateLimitInfo>;
  getCurrentCwd: () => string;
  setCurrentCwd: (cwd: string) => void;
  getLocalCwd: () => string;
  setLocalCwd: (cwd: string) => void;
  getSshHost: () => string | null;
  setSshHost: (host: string | null) => void;
  requireFields: (obj: Record<string, unknown>, ...fields: string[]) => void;
  toRemoteShellPath: (value: string) => string;
  expandLocalHomePath: (value: string) => string;
  toAbsoluteFilePath: (root: string, file: string) => string;
  captureGitDiff: (cwd: string, baseRef: string) => Promise<unknown | null>;
};

export function registerAuxiliaryIpcHandlers(deps: AuxiliaryIpcDeps): void {
  const {
    mainWindow,
    sessionStore,
    configManager,
    usageTracker,
    liveUsageService,
    workspaceStore,
    sendToRenderer,
    emitWorkspaceStatus,
    activeTasks,
    activeTerminals,
    cachedRateLimits,
    getCurrentCwd,
    setCurrentCwd,
    getLocalCwd,
    setLocalCwd,
    getSshHost,
    setSshHost,
    requireFields,
    toRemoteShellPath,
    expandLocalHomePath,
    toAbsoluteFilePath,
    captureGitDiff,
  } = deps;

  ipcMain.handle('sessions:list', async () => {
    return sessionStore.listWithSummaries();
  });

  ipcMain.handle('sessions:get', async (_event, { id }: { id: string }) => {
    return sessionStore.get(id);
  });

  ipcMain.handle('sessions:delete', async (_event, { id }: { id: string }) => {
    return sessionStore.delete(id);
  });

  ipcMain.handle('sessions:messages', async (_event, { id }: { id: string }) => {
    return sessionStore.getMessages(id);
  });

  ipcMain.handle('config:get', async () => {
    return configManager.get();
  });

  ipcMain.handle('config:set', async (_event, partial: Record<string, unknown>) => {
    return configManager.set(partial);
  });

  ipcMain.handle('theme:update-titlebar', async (_event, { theme }: { theme: 'dark' | 'light' }) => {
    if (process.platform !== 'win32') return;
    mainWindow.setTitleBarOverlay({
      color: theme === 'dark' ? '#111217' : '#f7f9fb',
      symbolColor: theme === 'dark' ? '#aeb09d' : '#2f3a2f',
    });
  });

  ipcMain.handle('window:is-fullscreen', async () => {
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('zoom:set', async (_event, { level }: { level: number }) => {
    const clamped = Math.max(0.5, Math.min(2.5, level));
    mainWindow.webContents.setZoomFactor(clamped);
    configManager.set({ zoomLevel: clamped } as any);
  });

  ipcMain.handle('zoom:get', async () => {
    return mainWindow.webContents.getZoomFactor() ?? 1.0;
  });

  ipcMain.handle('usage:get', async () => {
    return usageTracker.get();
  });

  ipcMain.handle('usage:rate-limits', async () => {
    return Array.from(cachedRateLimits.values());
  });

  ipcMain.handle('usage:live', async () => {
    return liveUsageService.getOverview(Array.from(cachedRateLimits.values()));
  });

  ipcMain.handle('cwd:get', async () => {
    return getCurrentCwd();
  });

  ipcMain.handle('cwd:set', async (_event, { cwd }: { cwd: string }) => {
    requireFields({ cwd }, 'cwd');
    setCurrentCwd(cwd);
    if (!getSshHost()) {
      setLocalCwd(cwd);
    }
    return getCurrentCwd();
  });

  ipcMain.handle('cwd:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: getCurrentCwd(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    setCurrentCwd(result.filePaths[0]);
    setLocalCwd(result.filePaths[0]);
    return getCurrentCwd();
  });

  ipcMain.handle('fs:pick-directory', async (_event, { defaultPath }: { defaultPath?: string } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: defaultPath ?? getCurrentCwd(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('cwd:create', async (_event, { parentPath, folderName, initGit }: { parentPath: string; folderName: string; initGit: boolean }) => {
    if (!folderName || /[/\\]/.test(folderName)) {
      return { error: 'Invalid folder name' };
    }
    if (folderName.length > 255) {
      return { error: 'Folder name too long' };
    }
    const newPath = path.join(parentPath, folderName);
    try {
      await fs.promises.mkdir(newPath, { recursive: false });
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        return { error: 'A folder with that name already exists' };
      }
      return { error: err.message ?? 'Failed to create folder' };
    }
    if (initGit) {
      try {
        await execFileAsync('git', ['init'], { cwd: newPath, timeout: 10000 });
      } catch (err: any) {
        return { error: `Folder created but git init failed: ${err.message}` };
      }
    }
    setCurrentCwd(newPath);
    setLocalCwd(newPath);
    return { path: newPath };
  });

  ipcMain.handle('git:is-repo', async (_event, { dirPath }: { dirPath?: string } = {}) => {
    const target = dirPath ?? getCurrentCwd();
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], {
        cwd: target,
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('git:branch', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: getCurrentCwd() });
      return stdout.trim();
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:upstream', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: getCurrentCwd() });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:status', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: getCurrentCwd() });
      return { dirty: stdout.trim().length > 0, files: stdout.trim() };
    } catch {
      return { dirty: false, files: '' };
    }
  });

  ipcMain.handle('fs:readdir', async (_event, { dirPath, depth = 3 }: { dirPath?: string; depth?: number }) => {
    const targetDir = dirPath ?? getCurrentCwd();
    const skipDirs = new Set(['node_modules', '.git', '.vite', 'dist', '.next', '__pycache__', '.cache']);

    interface TreeNode {
      name: string;
      path: string;
      isDirectory: boolean;
      children?: TreeNode[];
    }

    if (getSshHost()) {
      try {
        const skipFilter = Array.from(skipDirs)
          .map((d) => `-name '${d}'`)
          .join(' -o ');
        const escapedDir = targetDir.replace(/'/g, "'\\''");
        const cmd = `find '${escapedDir}' -maxdepth ${depth} \\( ${skipFilter} \\) -prune -o -not -name '.*' \\( -type d -o -type f \\) -print | while IFS= read -r p; do if [ -d "$p" ]; then echo "d $p"; else echo "f $p"; fi; done`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [getSshHost()!, cmd], {
          timeout: 15000,
          env: extendedEnv(),
        });

        const lines = stdout.trim().split('\n').filter(Boolean);
        const nodeMap = new Map<string, TreeNode>();
        const rootChildren: TreeNode[] = [];
        const normalizedRoot = targetDir.replace(/\/+$/, '');

        for (const line of lines) {
          const spaceIdx = line.indexOf(' ');
          if (spaceIdx === -1) continue;
          const type = line.charAt(0);
          const fullPath = line.substring(spaceIdx + 1);
          if (fullPath === normalizedRoot) continue;

          const name = fullPath.split('/').pop() || fullPath;
          if (name.startsWith('.') || skipDirs.has(name)) continue;

          const node: TreeNode = {
            name,
            path: fullPath,
            isDirectory: type === 'd',
          };
          if (type === 'd') node.children = [];
          nodeMap.set(fullPath, node);

          const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
          const parent = nodeMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(node);
          } else if (parentPath === normalizedRoot || parentPath === '') {
            rootChildren.push(node);
          }
        }

        function sortNodes(nodes: TreeNode[]): TreeNode[] {
          nodes.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          for (const n of nodes) {
            if (n.children) sortNodes(n.children);
          }
          return nodes;
        }

        return sortNodes(rootChildren);
      } catch {
        return [];
      }
    }

    function readTree(dir: string, currentDepth: number): TreeNode[] {
      if (currentDepth <= 0) return [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
          .filter((e) => !e.name.startsWith('.') && !skipDirs.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((entry) => {
            const fullPath = path.join(dir, entry.name);
            const node: TreeNode = {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
            };
            if (entry.isDirectory()) {
              node.children = readTree(fullPath, currentDepth - 1);
            }
            return node;
          });
      } catch {
        return [];
      }
    }

    return readTree(targetDir, depth);
  });

  ipcMain.handle('fs:read', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (getSshHost()) {
        const { stdout } = await execFileAsync(resolveSshCommand(), [getSshHost()!, `cat ${toRemoteShellPath(filePath)}`], {
          timeout: 10000,
          env: extendedEnv(),
        });
        return { content: stdout, error: null };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, error: null };
    } catch (err: any) {
      return { content: null, error: err.message };
    }
  });

  ipcMain.handle('fs:grep', async (_event, { pattern, cwd }: { pattern: string; cwd: string }) => {
    const results = await grepFiles(pattern, cwd);
    return results.map((result) => ({
      file: toAbsoluteFilePath(cwd, result.file),
      line: result.line,
      text: result.content,
    }));
  });

  ipcMain.handle('fs:listdirs', async (_event, { dirPath }: { dirPath: string }) => {
    const targetDir = dirPath || '~';
    try {
      if (getSshHost()) {
        const cmd = `cd ${toRemoteShellPath(targetDir)} 2>/dev/null && pwd && ls -1pA 2>/dev/null | head -200`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [getSshHost()!, cmd], {
          timeout: 10000,
          env: extendedEnv(),
        });
        const lines = stdout.trim().split('\n');
        const resolvedPath = lines[0] || targetDir;
        const entries = lines.slice(1).filter(Boolean).map((line) => ({
          name: line.replace(/\/$/, ''),
          isDirectory: line.endsWith('/'),
        }));
        return { path: resolvedPath, entries, error: null };
      }
      const resolved = path.resolve(expandLocalHomePath(targetDir));
      const dirEntries = fs.readdirSync(resolved, { withFileTypes: true });
      const entries = dirEntries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { path: resolved, entries, error: null };
    } catch (err: any) {
      return { path: targetDir, entries: [], error: err.message };
    }
  });

  ipcMain.handle('terminal:create', async (_event, { id, cwd: termCwd }: { id: string; cwd?: string }) => {
    requireFields({ id }, 'id');
    let shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    if (process.platform !== 'win32') {
      const preferred = process.env.SHELL;
      if (preferred && fs.existsSync(preferred)) {
        shell = preferred;
      }
    }
    const spawnCwd = getSshHost() ? getLocalCwd() : (termCwd ?? getCurrentCwd());

    let proc: ChildProcess;
    if (getSshHost()) {
      proc = spawn(resolveSshCommand(), ['-tt', getSshHost()!], {
        cwd: spawnCwd,
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (termCwd) {
        safeWriteToChildStdin(proc, `cd ${toRemoteShellPath(termCwd)}\n`, `terminal:${id}`);
      }
    } else {
      const shellArgs = process.platform === 'win32' ? ['-NoLogo', '-NoExit'] : ['-i'];
      proc = spawn(shell, shellArgs, {
        cwd: spawnCwd,
        env: extendedEnv({ TERM: 'xterm-256color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    attachChildStdinErrorHandler(proc, `terminal:${id}`);

    activeTerminals.set(id, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      sendToRenderer('terminal:data', { id, data: data.toString() });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      sendToRenderer('terminal:data', { id, data: data.toString() });
    });

    proc.on('exit', () => {
      activeTerminals.delete(id);
      sendToRenderer('terminal:exit', { id });
    });

    return { id };
  });

  ipcMain.handle('terminal:write', async (_event, { id, data }: { id: string; data: string }) => {
    const proc = activeTerminals.get(id);
    if (proc) safeWriteToChildStdin(proc, data, `terminal:${id}`);
  });

  ipcMain.handle('terminal:resize', async (_event, { id: _id, cols: _cols, rows: _rows }: { id: string; cols: number; rows: number }) => {
    // resize not supported without node-pty — no-op
  });

  ipcMain.handle('terminal:kill', async (_event, { id }: { id: string }) => {
    const proc = activeTerminals.get(id);
    if (proc) {
      proc.kill();
      activeTerminals.delete(id);
    }
  });

  ipcMain.handle('ssh:test', async (_event, { host }: { host: string }) => {
    try {
      await execFileAsync(resolveSshCommand(), ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], {
        timeout: 10000,
        env: extendedEnv(),
      });
      return { success: true, error: null };
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      return { success: false, error: `${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}` };
    }
  });

  ipcMain.handle('ssh:connect', async (_event, { host, remoteCwd }: { host: string; remoteCwd?: string }) => {
    try {
      await execFileAsync(resolveSshCommand(), ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], {
        timeout: 10000,
        env: extendedEnv(),
      });
    } catch (err: any) {
      const info = classifySpawnError(err as Error, { command: 'ssh', sshHost: host });
      throw new Error(`SSH connection failed: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`);
    }
    setSshHost(host);
    setToolsSshHost(host);
    setLocalCwd(getCurrentCwd());
    if (remoteCwd) setCurrentCwd(remoteCwd);
    await agentManager.detectAllRemote(host).catch(() => {});
    return { connected: true };
  });

  ipcMain.handle('ssh:disconnect', async () => {
    setSshHost(null);
    setToolsSshHost(null);
    setCurrentCwd(getLocalCwd());
    agentManager.detectAll().catch(() => {});
    return { connected: false, cwd: getCurrentCwd() };
  });

  ipcMain.handle('checkpoint:list', async (_event, { workspaceId }: { workspaceId: string }) => {
    return listCheckpoints(workspaceId);
  });

  ipcMain.handle('checkpoint:diff', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return getCheckpointDiff(checkpointId, workspace.worktreePath);
  });

  ipcMain.handle('checkpoint:revert', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    await revertToCheckpoint(workspace.worktreePath, checkpointId);
    emitWorkspaceStatus(workspaceId, 'done');
  });

  ipcMain.handle('repomap:get-config', async () => {
    return repoMapService.getConfig();
  });

  ipcMain.handle('repomap:set-config', async (_event, config: RepoMapConfig) => {
    const fullConfig = configManager.get();
    configManager.set({ repoMap: config });
    repoMapService.setConfig(config);
    if (config.enabled !== fullConfig.repoMap.enabled || config.enabled) {
      await repoMapService.init(getCurrentCwd(), config);
    }
  });

  ipcMain.handle('repomap:get-status', async () => {
    return repoMapService.getStatus();
  });

  ipcMain.handle('repomap:rebuild', async () => {
    await repoMapService.rebuild();
  });

  ipcMain.handle('repomap:preview', async (_event, { prompt }: { prompt: string }) => {
    const config = configManager.get().repoMap;
    return repoMapService.getMap(prompt, config.maxTokens);
  });

  ipcMain.handle('diff:get', async (_event, { taskId: _taskId, sessionId }: { taskId: string; sessionId: string }) => {
    const session = sessionStore.get(sessionId);
    if (!session) return null;
    return captureGitDiff(session.cwd, '');
  });

  ipcMain.handle('shell:exec', async (_event, { command, cwd, timeout }: { command: string; cwd: string; timeout?: number }) => {
    const start = Date.now();
    const result = await executeBash(command, cwd, timeout ?? 30000);
    const durationMs = Date.now() - start;
    const cap = 64 * 1024;
    return {
      stdout: result.stdout.slice(0, cap),
      stderr: result.stderr.slice(0, cap),
      exitCode: result.exitCode,
      durationMs,
    };
  });

  ipcMain.handle('completion:suggest', async (_event, { prefix, cwd, recentCommands, model }: { prefix: string; cwd: string; recentCommands: string[]; model?: string }) => {
    const result = await suggestCompletion(prefix, cwd, recentCommands, model);
    return result;
  });

  ipcMain.handle('completion:providers', () => {
    return { providers: availableCompletionProviders() };
  });

  ipcMain.handle('mcp:status', async (_event, { taskId }: { taskId: string }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('getMcpServerStatus' in handle)) return [];
    return (handle as SdkAgentHandle).getMcpServerStatus();
  });

  ipcMain.handle('mcp:reconnect', async (_event, { taskId, serverName }: { taskId: string; serverName: string }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('reconnectMcpServer' in handle)) return;
    await (handle as SdkAgentHandle).reconnectMcpServer(serverName);
  });

  ipcMain.handle('mcp:toggle', async (_event, { taskId, serverName, enabled }: { taskId: string; serverName: string; enabled: boolean }) => {
    const handle = activeTasks.get(taskId);
    if (!handle || !('toggleMcpServer' in handle)) return;
    await (handle as SdkAgentHandle).toggleMcpServer(serverName, enabled);
  });
}
