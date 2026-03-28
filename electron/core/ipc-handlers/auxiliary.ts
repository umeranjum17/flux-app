import { ipcMain, BrowserWindow, dialog } from 'electron';
import { execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

import fg from 'fast-glob';
import type { AgentHandle } from '../agents/types';
import { logDiagnostic, tailDiagnostics, getDiagnosticsLogPath } from '../diagnostics/logger';
import { ConfigManager } from '../config/config';
import { WorkspaceStore } from '../worktree/store';
import type { WorkspaceLifecycleManager } from '../worktree/lifecycle';
import { SessionStore } from '../session/store';
import { UsageTracker } from '../usage/tracker';
import { LiveUsageService, type LiveUsageOverview } from '../usage/live';
import type { RemoteConnectionManager } from '../remote/connection-manager';
import { grepFiles } from '../tools/grep';
import {
  extendedEnv,
  resolveSshCommand,
} from '../process-utils';
import { executeBash } from '../tools/bash';
import { suggestCompletion, availableCompletionProviders } from '../completion/service';
import { getCheckpointDiff, listCheckpoints, revertToCheckpoint } from '../checkpoint/manager';
import { registerTerminalIpcHandlers } from '../terminal/terminal-handlers';
import { remoteExecGit } from '../worktree/remote-manager';

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
  lifecycleManager: WorkspaceLifecycleManager;
  activeTasks: Map<string, AgentHandle>;
  activeTerminals: Map<string, ChildProcess>;
  cachedRateLimits: Map<string, RateLimitInfo>;
  getCurrentCwd: () => string;
  setCurrentCwd: (cwd: string) => void;
  remoteConnection: RemoteConnectionManager;
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
    lifecycleManager,
    activeTasks,
    activeTerminals,
    cachedRateLimits,
    getCurrentCwd,
    setCurrentCwd,
    remoteConnection,
    requireFields,
    toRemoteShellPath,
    expandLocalHomePath,
    toAbsoluteFilePath,
    captureGitDiff,
  } = deps;

  async function listRemoteDirectories(host: string, dirPath: string) {
    const targetDir = dirPath || '~';
    try {
      const cmd = `cd ${toRemoteShellPath(targetDir)} 2>/dev/null && pwd && ls -1pA 2>/dev/null | head -200`;
      const { stdout } = await execFileAsync(resolveSshCommand(), [host, cmd], {
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
    } catch (err: any) {
      return { path: targetDir, entries: [], error: err.message };
    }
  }

  ipcMain.handle('sessions:list', async (_event, args?: { limit?: number }) => {
    return sessionStore.listWithSummaries(args?.limit);
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

  ipcMain.handle('sessions:rename', async (_event, { id, title }: { id: string; title: string }) => {
    sessionStore.update(id, { title });
  });

  ipcMain.handle('sessions:export', async (_event, { id, format = 'markdown' }: { id: string; format?: 'markdown' | 'json' }) => {
    const session = sessionStore.get(id);
    const messages = sessionStore.getMessages(id);
    const summary = sessionStore.getSummary(id);
    const title = session?.title ?? 'Untitled Session';

    if (format === 'json') {
      return {
        content: JSON.stringify({ session, messages, summary }, null, 2),
        filename: `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.json`,
      };
    }

    // Markdown format
    const lines: string[] = [
      `# ${title}`,
      '',
      `**Agent:** ${session?.agentId ?? 'unknown'} | **Model:** ${session?.model ?? 'unknown'} | **Mode:** ${session?.mode ?? 'unknown'}`,
      `**Tokens:** ${summary.totalInputTokens.toLocaleString()} in / ${summary.totalOutputTokens.toLocaleString()} out | **Cost:** $${summary.totalCostUsd.toFixed(4)}`,
      `**Created:** ${session ? new Date(session.createdAt).toISOString() : 'unknown'}`,
      '',
      '---',
      '',
    ];
    for (const msg of messages) {
      const role = msg.role === 'assistant' ? '🤖 Assistant' : msg.role === 'user' ? '👤 User' : `🔧 ${msg.role}`;
      lines.push(`### ${role}`);
      if (msg.toolName) lines.push(`*Tool: ${msg.toolName}*`);
      lines.push('', msg.content || '*(empty)*', '');
    }
    return {
      content: lines.join('\n'),
      filename: `${title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.md`,
    };
  });

  ipcMain.handle('session:summary', async (_event, { id }: { id: string }) => {
    return sessionStore.getSummary(id);
  });

  ipcMain.handle('config:get', async () => {
    return configManager.get();
  });

  ipcMain.handle('config:set', async (_event, partial: Record<string, unknown>) => {
    configManager.set(partial);
    sendToRenderer('config:changed', { config: configManager.get() });
  });

  ipcMain.handle('config:reset', async () => {
    // Write an empty object so normalizeConfig applies all defaults
    configManager.set({
      theme: 'dark',
      fontSize: 14,
      sendKey: 'cmd+enter',
      preferredIde: 'code',
      defaultAgent: 'claude-code',
      defaultModel: 'sonnet',
      subagentModel: 'haiku',
      defaultThinking: 'medium',
      defaultMode: 'act',
      qualityGateCommands: [],
      qualityGateMaxRetries: 2,
      customAgentPaths: {},
      zoomLevel: 1.0,
      recentProjects: [],
      recentSshHosts: [],
    } as Record<string, unknown>);
    sendToRenderer('config:changed', { config: configManager.get() });
  });

  ipcMain.handle('config:export', async () => {
    return JSON.stringify(configManager.get(), null, 2);
  });

  ipcMain.handle('config:import', async (_event, { json }: { json: string }) => {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { success: false, error: 'Invalid config format: expected an object' };
      }
      configManager.set(parsed);
      sendToRenderer('config:changed', { config: configManager.get() });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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
    const RATE_LIMIT_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const evicted: string[] = [];
    // Evict stale entries and return only fresh ones
    for (const [key, info] of cachedRateLimits) {
      if (info.fetchedAt && now - info.fetchedAt > RATE_LIMIT_TTL_MS) {
        evicted.push(key);
        cachedRateLimits.delete(key);
      }
    }
    const result = Array.from(cachedRateLimits.values());
    logDiagnostic('usage', 'IPC usage:rate-limits response', {
      evicted,
      returnedCount: result.length,
      entries: result.map((r) => ({
        key: `${r.providerId}:${r.rateLimitType}`,
        utilization: r.utilization,
        status: r.status,
        resetsAt: r.resetsAt,
        fetchedAt: r.fetchedAt,
        ageMs: r.fetchedAt ? now - r.fetchedAt : null,
      })),
    });
    return result;
  });

  // Throttle usage:live so concurrent/rapid renderer calls coalesce into one
  // API round-trip.  The background poller in index.ts also updates this cache
  // via sendToRenderer('usage:live-update'), so the renderer rarely needs to
  // trigger its own fetch.
  const USAGE_LIVE_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
  let lastLiveResult: LiveUsageOverview | null = null;
  let lastLiveFetchAt = 0;
  let inflightLiveFetch: Promise<LiveUsageOverview> | null = null;

  ipcMain.handle('usage:live', async () => {
    const now = Date.now();

    // Return cached result if still fresh
    if (lastLiveResult && now - lastLiveFetchAt < USAGE_LIVE_THROTTLE_MS) {
      logDiagnostic('usage', 'IPC usage:live throttled (returning cached)', {
        ageMs: now - lastLiveFetchAt,
      });
      return lastLiveResult;
    }

    // Coalesce concurrent callers into one in-flight fetch
    if (inflightLiveFetch) {
      logDiagnostic('usage', 'IPC usage:live coalesced into in-flight fetch');
      return inflightLiveFetch;
    }

    const cached = Array.from(cachedRateLimits.values());
    logDiagnostic('usage', 'IPC usage:live invoked', {
      cachedRateLimitCount: cached.length,
      cachedKeys: cached.map((r) => `${r.providerId}:${r.rateLimitType}`),
    });

    inflightLiveFetch = liveUsageService.getOverview(cached).finally(() => {
      inflightLiveFetch = null;
    });

    const overview = await inflightLiveFetch;
    lastLiveResult = overview;
    lastLiveFetchAt = Date.now();

    logDiagnostic('usage', 'IPC usage:live response', {
      providerCount: overview.providers.length,
      providers: overview.providers.map((p) => ({
        providerId: p.providerId,
        status: p.status,
        source: p.source,
        windowCount: p.windows.length,
        windows: p.windows.map((w) => ({
          windowKey: w.windowKey,
          usedPercent: w.usedPercent,
          status: w.status,
          resetsAt: w.resetsAt,
          remainingMs: w.remainingMs,
          isStale: w.isStale,
          isExpired: w.isExpired,
          source: w.source,
        })),
      })),
    });
    return overview;
  });

  ipcMain.handle('cwd:get', async () => {
    return getCurrentCwd();
  });

  ipcMain.handle('cwd:set', async (_event, { cwd }: { cwd: string }) => {
    requireFields({ cwd }, 'cwd');
    setCurrentCwd(cwd);
    if (!remoteConnection.isConnected()) {
      remoteConnection.localCwd = cwd;
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
    remoteConnection.localCwd = result.filePaths[0];
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
        await fs.promises.appendFile(path.join(newPath, '.gitignore'), '.context\n');
        // Create an initial empty commit so worktrees work immediately
        await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], {
          cwd: newPath,
          timeout: 10000,
        });
      } catch (err: any) {
        return { error: `Folder created but git init failed: ${err.message}` };
      }
    }
    setCurrentCwd(newPath);
    remoteConnection.localCwd = newPath;
    return { path: newPath };
  });

  ipcMain.handle('git:init', async (_event, { dirPath }: { dirPath?: string } = {}) => {
    const target = dirPath ?? getCurrentCwd();
    const host = remoteConnection.host;
    try {
      if (host) {
        await remoteExecGit(host, target, ['init'], 10000);
        const { sshExec } = await import('../tools/ssh');
        const escapedTarget = target.replace(/'/g, "'\\''");
        await sshExec(host, `echo '.context' >> '${escapedTarget}/.gitignore'`, 5000);
        await remoteExecGit(host, target, ['commit', '--allow-empty', '-m', 'Initial commit'], 10000);
      } else {
        await execFileAsync('git', ['init'], { cwd: target, timeout: 10000 });
        await fs.promises.appendFile(path.join(target, '.gitignore'), '.context\n');
        await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], {
          cwd: target,
          timeout: 10000,
        });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Failed to initialize git repository' };
    }
  });

  ipcMain.handle('git:is-repo', async (_event, { dirPath }: { dirPath?: string } = {}) => {
    const target = dirPath ?? getCurrentCwd();
    const host = remoteConnection.host;
    try {
      if (host) {
        await remoteExecGit(host, target, ['rev-parse', '--git-dir'], 5000);
      } else {
        await execFileAsync('git', ['rev-parse', '--git-dir'], {
          cwd: target,
          timeout: 5000,
        });
      }
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('git:branch', async () => {
    const cwd = getCurrentCwd();
    const host = remoteConnection.host;
    try {
      if (host) {
        const { stdout } = await remoteExecGit(host, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 5000);
        return stdout.trim();
      }
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
      return stdout.trim();
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:upstream', async () => {
    const cwd = getCurrentCwd();
    const host = remoteConnection.host;
    try {
      if (host) {
        const { stdout } = await remoteExecGit(host, cwd, ['rev-parse', '--abbrev-ref', '@{upstream}'], 5000);
        return stdout.trim() || null;
      }
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:status', async () => {
    const cwd = getCurrentCwd();
    const host = remoteConnection.host;
    try {
      if (host) {
        const { stdout } = await remoteExecGit(host, cwd, ['status', '--porcelain'], 5000);
        return { dirty: stdout.trim().length > 0, files: stdout.trim() };
      }
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
      return { dirty: stdout.trim().length > 0, files: stdout.trim() };
    } catch {
      return { dirty: false, files: '' };
    }
  });

  // Combined git info — single IPC round trip instead of 4 sequential calls
  ipcMain.handle('git:info', async () => {
    const cwd = getCurrentCwd();
    const host = remoteConnection.host;

    const execGit = (args: string[], timeout = 5000) =>
      host
        ? remoteExecGit(host, cwd, args, timeout)
        : execFileAsync('git', args, { cwd, timeout });

    try {
      await execGit(['rev-parse', '--git-dir']);
    } catch {
      return { isRepo: false, branch: null, upstream: null, dirty: false };
    }
    const [branchRes, upstreamRes, statusRes] = await Promise.allSettled([
      execGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      execGit(['rev-parse', '--abbrev-ref', '@{upstream}']),
      execGit(['status', '--porcelain']),
    ]);
    return {
      isRepo: true,
      branch: branchRes.status === 'fulfilled' ? branchRes.value.stdout.trim() : null,
      upstream: upstreamRes.status === 'fulfilled' ? (upstreamRes.value.stdout.trim() || null) : null,
      dirty: statusRes.status === 'fulfilled' ? statusRes.value.stdout.trim().length > 0 : false,
    };
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

    if (remoteConnection.host) {
      try {
        const skipFilter = Array.from(skipDirs)
          .map((d) => `-name '${d}'`)
          .join(' -o ');
        const escapedDir = targetDir.replace(/'/g, "'\\''");
        const cmd = `find '${escapedDir}' -maxdepth ${depth} \\( ${skipFilter} \\) -prune -o -not -name '.*' \\( -type d -o -type f \\) -print | while IFS= read -r p; do if [ -d "$p" ]; then echo "d $p"; else echo "f $p"; fi; done`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [remoteConnection.host!, cmd], {
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
      if (remoteConnection.host) {
        const { stdout } = await execFileAsync(resolveSshCommand(), [remoteConnection.host!, `cat ${toRemoteShellPath(filePath)}`], {
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

  ipcMain.handle('fs:glob', async (_event, { cwd, limit = 5000 }: { cwd: string; limit?: number }) => {
    try {
      if (remoteConnection.host) {
        const escapedDir = cwd.replace(/'/g, "'\\''");
        const cmd = `cd '${escapedDir}' && git ls-files 2>/dev/null || find . -type f -not -path '*/.*' -not -path '*/node_modules/*' | head -${limit}`;
        const { stdout } = await execFileAsync(resolveSshCommand(), [remoteConnection.host!, cmd], {
          timeout: 15000,
          env: extendedEnv(),
        });
        return stdout.trim().split('\n').filter(Boolean).slice(0, limit).map((rel) => ({
          path: rel,
          name: rel.split('/').pop() || rel,
        }));
      }

      // Local: prefer git ls-files for speed and .gitignore respect
      try {
        const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
          cwd,
          timeout: 10000,
        });
        const files = stdout.trim().split('\n').filter(Boolean).slice(0, limit);
        return files.map((rel) => ({
          path: rel,
          name: rel.split('/').pop() || rel,
        }));
      } catch {
        // Not a git repo — fall back to fast-glob
        const files = await fg('**/*', {
          cwd,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**', '**/__pycache__/**', '**/.cache/**'],
          onlyFiles: true,
          dot: false,
        });
        return files.slice(0, limit).map((rel) => ({
          path: rel,
          name: rel.split('/').pop() || rel,
        }));
      }
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:listdirs', async (_event, { dirPath }: { dirPath: string }) => {
    const targetDir = dirPath || '~';
    try {
      if (remoteConnection.host) {
        return listRemoteDirectories(remoteConnection.host, targetDir);
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

  ipcMain.handle('ssh:listdirs', async (_event, { host, dirPath }: { host: string; dirPath: string }) => {
    requireFields({ host }, 'host');
    return listRemoteDirectories(host, dirPath);
  });

  // Terminal handlers are registered in the dedicated terminal module
  registerTerminalIpcHandlers({
    sendToRenderer,
    activeTerminals,
    getCurrentCwd,
    remoteConnection,
    toRemoteShellPath,
    requireFields,
    getWorkspacePath: (workspaceId: string) => workspaceStore.get(workspaceId)?.worktreePath,
    getWorkspaceSshHost: (workspaceId: string) => workspaceStore.get(workspaceId)?.sshHost,
  });

  ipcMain.handle('ssh:init-project', async (_event, { host, dirPath }: { host: string; dirPath: string }) => {
    requireFields({ host, dirPath }, 'host', 'dirPath');
    try {
      const cmd = `mkdir -p ${toRemoteShellPath(dirPath)} && cd ${toRemoteShellPath(dirPath)} && git init && pwd`;
      const { stdout } = await execFileAsync(resolveSshCommand(), [host, cmd], {
        timeout: 15000,
        env: extendedEnv(),
      });
      const lines = stdout.trim().split('\n');
      const resolvedPath = lines[lines.length - 1] || dirPath;
      return { path: resolvedPath, error: null };
    } catch (err: any) {
      return { path: dirPath, error: err.message };
    }
  });

  ipcMain.handle('ssh:test', async (_event, { host }: { host: string }) => {
    return remoteConnection.test(host);
  });

  ipcMain.handle('ssh:connect', async (_event, { host, remoteCwd }: { host: string; remoteCwd?: string }) => {
    await remoteConnection.connect(host, getCurrentCwd());
    if (remoteCwd) setCurrentCwd(remoteCwd);
    return { connected: true };
  });

  ipcMain.handle('ssh:disconnect', async () => {
    const previousHost = remoteConnection.host;
    const localCwd = remoteConnection.disconnect();
    setCurrentCwd(localCwd);
    if (previousHost) {
      const { clearRemoteHomeCache } = await import('../worktree/remote-manager');
      clearRemoteHomeCache(previousHost);
    }
    return { connected: false, cwd: getCurrentCwd() };
  });

  ipcMain.handle('checkpoint:list', async (_event, { workspaceId }: { workspaceId: string }) => {
    return listCheckpoints(workspaceId);
  });

  ipcMain.handle('checkpoint:diff', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return null;
    return getCheckpointDiff(checkpointId, workspace.worktreePath);
  });

  ipcMain.handle('checkpoint:revert', async (_event, { checkpointId, workspaceId }: { checkpointId: string; workspaceId: string }) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;
    await revertToCheckpoint(workspace.worktreePath, checkpointId);
    lifecycleManager.setStatus(workspaceId, 'done');
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

  ipcMain.handle('mcp:status', async () => {
    return [];
  });

  ipcMain.handle('mcp:reconnect', async () => {
    // No-op: SDK-based MCP management removed
  });

  ipcMain.handle('mcp:toggle', async () => {
    // No-op: SDK-based MCP management removed
  });

  // --- Git extended operations ---

  ipcMain.handle('git:log', async (_event, { cwd: logCwd, maxCount = 50 }: { cwd?: string; maxCount?: number }) => {
    const targetCwd = logCwd || getCurrentCwd();
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', `--max-count=${maxCount}`, '--format=%H%x00%h%x00%an%x00%aI%x00%s'],
        { cwd: targetCwd, timeout: 10000, encoding: 'utf-8' },
      );
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [sha, shortSha, author, date, message] = line.split('\0');
        return { sha, shortSha, author, date, message };
      });
    } catch {
      return [];
    }
  });

  ipcMain.handle('git:diff-stat', async (_event, { cwd: statCwd }: { cwd?: string } = {}) => {
    const targetCwd = statCwd || getCurrentCwd();
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--stat', '--numstat', 'HEAD'],
        { cwd: targetCwd, timeout: 10000, encoding: 'utf-8' },
      );
      let filesChanged = 0;
      let additions = 0;
      let deletions = 0;
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          filesChanged++;
          const add = parseInt(parts[0], 10);
          const del = parseInt(parts[1], 10);
          if (!isNaN(add)) additions += add;
          if (!isNaN(del)) deletions += del;
        }
      }
      return { filesChanged, additions, deletions };
    } catch {
      return { filesChanged: 0, additions: 0, deletions: 0 };
    }
  });

  // --- Active task introspection ---

  ipcMain.handle('agents:active-tasks', async () => {
    const tasks: Array<{ taskId: string; agentId: string; workspaceId?: string; isAlive: boolean; pid?: number }> = [];
    for (const [taskId, handle] of activeTasks.entries()) {
      tasks.push({
        taskId,
        agentId: handle.agentId,
        workspaceId: lifecycleManager.getWorkspaceForTask(taskId),
        isAlive: handle.isAlive(),
        pid: handle.pid,
      });
    }
    return tasks;
  });

  // --- File system extended ---

  ipcMain.handle('fs:stat', async (_event, { filePath }: { filePath: string }) => {
    try {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(getCurrentCwd(), filePath);
      const stat = fs.statSync(resolved);
      return {
        size: stat.size,
        modifiedMs: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:write', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(getCurrentCwd(), filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- Diagnostics ---

  ipcMain.handle('diagnostics:logs', async (_event, { lines = 200 }: { lines?: number } = {}) => {
    return tailDiagnostics(lines);
  });

  ipcMain.handle('diagnostics:log-path', async () => {
    return getDiagnosticsLogPath();
  });
}
