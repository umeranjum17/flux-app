import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { agentManager } from './agents/manager';
import { SessionStore } from './session/store';
import { ConfigManager } from './config/config';
import { UsageTracker } from './usage/tracker';
import type { AgentHandle, SpawnOptions, AgentId, AgentMessage, FileAttachment } from './agents/types';
import { setSshHost as setToolsSshHost } from './tools/ssh';
import { grepFiles } from './tools/grep';

const execFileAsync = promisify(execFile);
const MAX_ATTACHED_FILES = 6;
const MAX_ATTACHMENT_CHARS_PER_FILE = 12_000;
const MAX_TOTAL_ATTACHMENT_CHARS = 40_000;

function requireFields(obj: Record<string, unknown>, ...fields: string[]): void {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null) {
      throw new Error(`Missing required field: ${f}`);
    }
  }
}

const activeTasks = new Map<string, AgentHandle>();
const taskSessions = new Map<string, string>();
const activeTerminals = new Map<string, ChildProcess>();
let currentCwd = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
let localCwd = currentCwd;
let sshHost: string | null = null;

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toRemoteShellPath(value: string): string {
  const trimmed = value.trim() || '~';
  if (trimmed === '~') return '"$HOME"';
  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2);
    return rest ? `"${'$'}HOME"/${escapeShellArg(rest)}` : '"$HOME"';
  }
  return escapeShellArg(trimmed);
}

function expandLocalHomePath(value: string): string {
  const trimmed = value.trim() || '~';
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '/';
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/')) return path.join(homeDir, trimmed.slice(2));
  return trimmed;
}

function buildSessionTitle(prompt: string): string {
  const nonEmptyLines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (nonEmptyLines[nonEmptyLines.length - 1] ?? 'Untitled').slice(0, 80);
}

function serializePayload(payload: unknown): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function toStoredMessage(message: AgentMessage) {
  return {
    role: message.role,
    type: message.type,
    content: message.content,
    toolName: message.toolName ?? null,
    toolInput: message.toolInput ? JSON.stringify(message.toolInput) : null,
    toolCallId: message.toolCallId ?? null,
    costUsd: message.costUsd ?? null,
    inputTokens: message.inputTokens ?? null,
    outputTokens: message.outputTokens ?? null,
    payloadJson: serializePayload(message),
  };
}

function buildStoredUserMessage(
  prompt: string,
  images?: string[],
  attachments?: FileAttachment[],
) {
  const payload: AgentMessage = {
    type: 'text',
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
    ...(images?.length ? { images } : {}),
    ...(attachments?.length ? { attachments } : {}),
  };

  return {
    role: 'user',
    type: 'text',
    content: prompt,
    toolName: null,
    toolInput: null,
    toolCallId: null,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
    payloadJson: serializePayload(payload),
  };
}

function toAbsoluteFilePath(root: string, file: string): string {
  if (path.isAbsolute(file)) return file;
  if (root === '/') return `/${file}`;
  return `${root.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}

async function buildPromptWithAttachments(
  prompt: string,
  attachments?: FileAttachment[],
): Promise<string> {
  if (!attachments?.length) return prompt;

  const blocks: string[] = [];
  let remainingChars = MAX_TOTAL_ATTACHMENT_CHARS;

  for (const attachment of attachments.slice(0, MAX_ATTACHED_FILES)) {
    if (remainingChars <= 0) break;

    try {
      const preview = await readAttachmentPreview(
        attachment.path,
        Math.min(MAX_ATTACHMENT_CHARS_PER_FILE, remainingChars),
      );
      remainingChars -= preview.text.length;

      if (preview.binary) {
        blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n[Binary file omitted]`);
        continue;
      }

      const suffix = preview.truncated ? '\n[Truncated attachment preview]' : '';
      blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n${preview.text}${suffix}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      blocks.push(`--- ${attachment.name} (${attachment.path}) ---\n[Unable to read attachment: ${message}]`);
    }
  }

  if (attachments.length > MAX_ATTACHED_FILES) {
    blocks.push(`[${attachments.length - MAX_ATTACHED_FILES} additional attachments omitted]`);
  }

  if (blocks.length === 0) return prompt;

  return `Attached file context:\n\n${blocks.join('\n\n')}\n\nUser request:\n${prompt}`;
}

async function readAttachmentPreview(
  filePath: string,
  maxChars: number,
): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  if (sshHost) {
    const cmd = `head -c ${maxChars + 1} ${toRemoteShellPath(filePath)}`;
    const { stdout } = await execFileAsync('ssh', [sshHost, cmd], { timeout: 10000 });
    const text = stdout;
    return {
      text: text.slice(0, maxChars),
      truncated: text.length > maxChars,
      binary: text.includes('\u0000'),
    };
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxChars + 1);
    const bytesRead = fs.readSync(fd, buffer, 0, maxChars + 1, 0);
    const slice = buffer.subarray(0, bytesRead);
    const truncated = bytesRead > maxChars;
    return {
      text: slice.subarray(0, Math.min(bytesRead, maxChars)).toString('utf-8'),
      truncated,
      binary: slice.includes(0),
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessionStore = new SessionStore();
  const configManager = new ConfigManager();
  const usageTracker = new UsageTracker();
  const registeredChannels = [
    'agents:detect',
    'agents:check-auth',
    'agents:list-models',
    'task:spawn',
    'task:stop',
    'task:approve',
    'task:deny',
    'task:steer',
    'sessions:list',
    'sessions:get',
    'sessions:delete',
    'sessions:messages',
    'config:get',
    'config:set',
    'usage:get',
    'cwd:get',
    'cwd:set',
    'cwd:pick',
    'git:branch',
    'git:status',
    'fs:readdir',
    'fs:read',
    'fs:grep',
    'fs:listdirs',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:kill',
    'ssh:test',
    'ssh:connect',
    'ssh:disconnect',
  ];
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel);
  }

  // --- Agent handlers ---

  ipcMain.handle('agents:detect', async () => {
    return agentManager.detectAll();
  });

  ipcMain.handle('agents:check-auth', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.checkAuth(agentId);
  });

  ipcMain.handle('agents:list-models', async (_event, { agentId }: { agentId: string }) => {
    return agentManager.listModels(agentId as AgentId);
  });

  // --- Task handlers ---

  ipcMain.handle('task:spawn', async (_event, options: SpawnOptions & { agentId?: string }) => {
    requireFields(options as unknown as Record<string, unknown>, 'taskId', 'prompt', 'cwd');
    const agentId = (options.agentId ?? 'claude-code') as AgentId;
    if (activeTasks.has(options.taskId)) {
      throw new Error(`Task ${options.taskId} already has an active run`);
    }

    const effectivePrompt = await buildPromptWithAttachments(options.prompt, options.attachments);
    const existingSession = options.sessionId ? sessionStore.get(options.sessionId) : null;
    const session = existingSession ?? sessionStore.create({
      title: buildSessionTitle(options.prompt),
      agentId,
      model: options.model ?? '',
      mode: options.mode,
      cwd: options.cwd,
      metadata: {},
    });

    let handle: AgentHandle;
    try {
      handle = agentManager.spawn(agentId, { ...options, prompt: effectivePrompt });
    } catch (err) {
      if (!existingSession) {
        sessionStore.delete(session.id);
      }
      throw err;
    }

    if (existingSession) {
      sessionStore.update(session.id, {
        agentId,
        model: options.model ?? session.model,
        mode: options.mode,
        cwd: options.cwd,
      });
    }

    if (options.prompt !== '[Resuming previous session]') {
      sessionStore.addMessage(
        session.id,
        buildStoredUserMessage(options.prompt, options.images, options.attachments),
      );
    }

    activeTasks.set(options.taskId, handle);
    taskSessions.set(options.taskId, session.id);

    handle.on('message', (message) => {
      sessionStore.addMessage(session.id, toStoredMessage(message));
      if (message.type === 'permission_request') {
        mainWindow.webContents.send('agent:permission', {
          taskId: options.taskId,
          requestId: message.requestId,
          toolName: message.toolName ?? 'unknown',
          description: message.content,
          action: message.action,
          path: message.filePath,
        });
      }
      mainWindow.webContents.send('agent:message', { taskId: options.taskId, message });
    });

    handle.on('done', (result) => {
      mainWindow.webContents.send('agent:done', { taskId: options.taskId, error: result?.error });
      activeTasks.delete(options.taskId);
      taskSessions.delete(options.taskId);
    });

    return { taskId: options.taskId, session: sessionStore.get(session.id) ?? session };
  });

  ipcMain.handle('task:stop', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    const handle = activeTasks.get(taskId);
    if (handle) {
      handle.stop();
      activeTasks.delete(taskId);
    }
    taskSessions.delete(taskId);
  });

  ipcMain.handle('task:approve', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.approve(requestId);
  });

  ipcMain.handle('task:deny', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.deny(requestId);
  });

  ipcMain.handle('task:steer', async (_event, { taskId, prompt, images, attachments }: { taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }) => {
    const handle = activeTasks.get(taskId);
    if (!handle) {
      throw new Error(`Task ${taskId} does not have an active run`);
    }

    const effectivePrompt = await buildPromptWithAttachments(prompt, attachments);
    handle.steer(effectivePrompt, images);

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      sessionStore.addMessage(
        sessionId,
        buildStoredUserMessage(prompt, images, attachments),
      );
    }
  });

  // --- Session handlers ---

  ipcMain.handle('sessions:list', async () => {
    return sessionStore.list();
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

  // --- Config handlers ---

  ipcMain.handle('config:get', async () => {
    return configManager.get();
  });

  ipcMain.handle('config:set', async (_event, partial: Record<string, unknown>) => {
    return configManager.set(partial);
  });

  // --- Usage handlers ---

  ipcMain.handle('usage:get', async () => {
    return usageTracker.get();
  });

  // --- CWD handlers ---

  ipcMain.handle('cwd:get', async () => {
    return currentCwd;
  });

  ipcMain.handle('cwd:set', async (_event, { cwd }: { cwd: string }) => {
    requireFields({ cwd }, 'cwd');
    currentCwd = cwd;
    if (!sshHost) {
      localCwd = cwd;
    }
    return currentCwd;
  });

  ipcMain.handle('cwd:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      defaultPath: currentCwd,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    currentCwd = result.filePaths[0];
    localCwd = currentCwd;
    return currentCwd;
  });

  // --- Git handlers ---

  ipcMain.handle('git:branch', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: currentCwd });
      return stdout.trim();
    } catch {
      return null;
    }
  });

  ipcMain.handle('git:status', async () => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: currentCwd });
      return { dirty: stdout.trim().length > 0, files: stdout.trim() };
    } catch {
      return { dirty: false, files: '' };
    }
  });

  // --- Filesystem handlers ---

  ipcMain.handle('fs:readdir', async (_event, { dirPath, depth = 3 }: { dirPath?: string; depth?: number }) => {
    const targetDir = dirPath ?? currentCwd;
    const skipDirs = new Set(['node_modules', '.git', '.vite', 'dist', '.next', '__pycache__', '.cache']);

    interface TreeNode {
      name: string;
      path: string;
      isDirectory: boolean;
      children?: TreeNode[];
    }

    // SSH remote read
    if (sshHost) {
      try {
        const skipFilter = Array.from(skipDirs)
          .map((d) => `-name '${d}'`)
          .join(' -o ');
        const escapedDir = targetDir.replace(/'/g, "'\\''");
        const cmd = `find '${escapedDir}' -maxdepth ${depth} \\( ${skipFilter} \\) -prune -o -not -name '.*' \\( -type d -o -type f \\) -print | while IFS= read -r p; do if [ -d "$p" ]; then echo "d $p"; else echo "f $p"; fi; done`;
        const { stdout } = await execFileAsync('ssh', [sshHost, cmd], { timeout: 15000 });

        const lines = stdout.trim().split('\n').filter(Boolean);
        // Build a map of path -> TreeNode
        const nodeMap = new Map<string, TreeNode>();
        const rootChildren: TreeNode[] = [];

        // Normalize targetDir (remove trailing slash)
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

          // Find parent
          const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
          const parent = nodeMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(node);
          } else if (parentPath === normalizedRoot || parentPath === '') {
            rootChildren.push(node);
          }
        }

        // Sort each level: directories first, then alphabetical
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

    // Local read
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
      if (sshHost) {
        const { stdout } = await execFileAsync('ssh', [sshHost, `cat ${toRemoteShellPath(filePath)}`], { timeout: 10000 });
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

  // Remote directory listing for SSH folder picker
  ipcMain.handle('fs:listdirs', async (_event, { dirPath }: { dirPath: string }) => {
    const targetDir = dirPath || '~';
    try {
      if (sshHost) {
        // Resolve ~ and list directories + get the resolved path
        const cmd = `cd ${toRemoteShellPath(targetDir)} 2>/dev/null && pwd && ls -1pA 2>/dev/null | head -200`;
        const { stdout } = await execFileAsync('ssh', [sshHost, cmd], { timeout: 10000 });
        const lines = stdout.trim().split('\n');
        const resolvedPath = lines[0] || targetDir;
        const entries = lines.slice(1).filter(Boolean).map((line) => ({
          name: line.replace(/\/$/, ''),
          isDirectory: line.endsWith('/'),
        }));
        return { path: resolvedPath, entries, error: null };
      }
      // Local fallback
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

  // --- Terminal handlers ---

  ipcMain.handle('terminal:create', async (_event, { id, cwd: termCwd }: { id: string; cwd?: string }) => {
    requireFields({ id }, 'id');
    let shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    if (process.platform !== 'win32') {
      const preferred = process.env.SHELL;
      if (preferred && fs.existsSync(preferred)) {
        shell = preferred;
      }
    }
    const spawnCwd = sshHost ? localCwd : (termCwd ?? currentCwd);

    let proc: ChildProcess;

    if (sshHost) {
      proc = spawn('ssh', ['-tt', sshHost], {
        cwd: spawnCwd,
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (termCwd && proc.stdin?.writable) {
        proc.stdin.write(`cd ${toRemoteShellPath(termCwd)}\n`);
      }
    } else {
      proc = spawn(shell, ['-i'], {
        cwd: spawnCwd,
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    activeTerminals.set(id, proc);

    proc.stdout?.on('data', (data: Buffer) => {
      mainWindow.webContents.send('terminal:data', { id, data: data.toString() });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      mainWindow.webContents.send('terminal:data', { id, data: data.toString() });
    });

    proc.on('exit', () => {
      activeTerminals.delete(id);
      mainWindow.webContents.send('terminal:exit', { id });
    });

    return { id };
  });

  ipcMain.handle('terminal:write', async (_event, { id, data }: { id: string; data: string }) => {
    const proc = activeTerminals.get(id);
    if (proc?.stdin?.writable) proc.stdin.write(data);
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

  // --- SSH handlers ---

  ipcMain.handle('ssh:test', async (_event, { host }: { host: string }) => {
    try {
      await execFileAsync('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], { timeout: 10000 });
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ssh:connect', async (_event, { host, remoteCwd }: { host: string; remoteCwd?: string }) => {
    // Verify SSH connectivity before committing
    try {
      await execFileAsync('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', host, 'echo', 'ok'], { timeout: 10000 });
    } catch (err: any) {
      throw new Error(`SSH connection failed: ${err.message}`);
    }
    sshHost = host;
    setToolsSshHost(host);
    localCwd = currentCwd;
    if (remoteCwd) currentCwd = remoteCwd;
    return { connected: true };
  });

  ipcMain.handle('ssh:disconnect', async () => {
    sshHost = null;
    setToolsSshHost(null);
    currentCwd = localCwd;
    return { connected: false, cwd: currentCwd };
  });
}
