import { contextBridge, ipcRenderer } from 'electron';
import type { IpcActivity } from '../src/lib/ipc-api';

type Listener = (...args: any[]) => void;

const IPC_ACTIVITY_CHANNEL = 'ipc:activity';
const TRACKED_INVOKE_PREFIXES = ['task:', 'subagent:', 'workspace:', 'checkpoint:', 'repomap:', 'mcp:'];

const listenerMap = new Map<string, Map<Listener, Listener>>();
const internalListeners = new Map<string, Set<Listener>>();
const taskToWorkspace = new Map<string, string>();
const terminalToWorkspace = new Map<string, string>();

function shouldTraceInvokeChannel(channel: string): boolean {
  return TRACKED_INVOKE_PREFIXES.some((prefix) => channel.startsWith(prefix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function safePreview(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (!json || json === '{}' || json === '[]' || json === 'null') return undefined;
    return truncate(json);
  } catch {
    return undefined;
  }
}

function extractContextFromValue(value: unknown): Pick<IpcActivity, 'taskId' | 'workspaceId' | 'sessionId' | 'terminalId'> {
  if (!isRecord(value)) {
    return {};
  }

  const workspace = isRecord(value.workspace) ? value.workspace : undefined;

  return {
    ...(getString(value.taskId) ? { taskId: getString(value.taskId) } : {}),
    ...(getString(value.workspaceId) ? { workspaceId: getString(value.workspaceId) } : {}),
    ...(getString(workspace?.id) ? { workspaceId: getString(workspace?.id) } : {}),
    ...(getString(value.sessionId) ? { sessionId: getString(value.sessionId) } : {}),
    ...(isRecord(value.session) && getString(value.session.id) ? { sessionId: getString(value.session.id) } : {}),
    ...(getString(value.terminalId) ? { terminalId: getString(value.terminalId) } : {}),
    ...(getString(value.id) && (value.id as string).startsWith('run-') ? { terminalId: getString(value.id) } : {}),
  };
}

function rememberContext(channel: string, args: unknown[], result?: unknown): void {
  const requestContext = extractContextFromValue(args[0]);
  if (requestContext.taskId && requestContext.workspaceId) {
    taskToWorkspace.set(requestContext.taskId, requestContext.workspaceId);
  }

  if (channel === 'workspace:run-command') {
    const responseContext = extractContextFromValue(result);
    if (requestContext.workspaceId && responseContext.terminalId) {
      terminalToWorkspace.set(responseContext.terminalId, requestContext.workspaceId);
    }
  }
}

function enrichActivity(activity: IpcActivity): IpcActivity {
  const enriched = { ...activity };
  if (!enriched.workspaceId && enriched.taskId) {
    const mapped = taskToWorkspace.get(enriched.taskId);
    if (mapped) enriched.workspaceId = mapped;
  }
  if (!enriched.workspaceId && enriched.terminalId) {
    const mapped = terminalToWorkspace.get(enriched.terminalId);
    if (mapped) enriched.workspaceId = mapped;
  }
  return enriched;
}

function extractSummary(channel: string, payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  if (channel === 'workspace:run-command' && getString(payload.command)) {
    return truncate(payload.command as string, 120);
  }
  if (channel === 'workspace:run-exit' && typeof payload.exitCode === 'number') {
    return `exit ${payload.exitCode}`;
  }
  if (channel === 'workspace:completion' && getString(payload.suggestedMergeTarget)) {
    return `merge to ${payload.suggestedMergeTarget}`;
  }
  if (channel === 'workspace:create-pr' && typeof payload.number === 'number') {
    return `PR #${payload.number}`;
  }
  if (channel === 'workspace:merge' && getString(payload.targetBranch)) {
    return `target ${payload.targetBranch}`;
  }
  if (channel === 'workspace:rename-branch' && getString(payload.newBranch)) {
    return `branch ${payload.newBranch}`;
  }
  if (channel === 'workspace:created' && isRecord(payload.workspace) && getString(payload.workspace.name)) {
    return truncate(payload.workspace.name as string, 80);
  }
  if (getString(payload.branch)) {
    return `branch ${payload.branch}`;
  }
  if (typeof payload.exitCode === 'number') {
    return `exit ${payload.exitCode}`;
  }
  if (getString(payload.serverName)) {
    return truncate(payload.serverName as string, 80);
  }
  return undefined;
}

function mergeContext(
  primary: Pick<IpcActivity, 'taskId' | 'workspaceId' | 'sessionId' | 'terminalId'>,
  fallback?: Pick<IpcActivity, 'taskId' | 'workspaceId' | 'sessionId' | 'terminalId'>,
): Pick<IpcActivity, 'taskId' | 'workspaceId' | 'sessionId' | 'terminalId'> {
  return {
    ...(fallback?.taskId ? { taskId: fallback.taskId } : {}),
    ...(fallback?.workspaceId ? { workspaceId: fallback.workspaceId } : {}),
    ...(fallback?.sessionId ? { sessionId: fallback.sessionId } : {}),
    ...(fallback?.terminalId ? { terminalId: fallback.terminalId } : {}),
    ...(primary.taskId ? { taskId: primary.taskId } : {}),
    ...(primary.workspaceId ? { workspaceId: primary.workspaceId } : {}),
    ...(primary.sessionId ? { sessionId: primary.sessionId } : {}),
    ...(primary.terminalId ? { terminalId: primary.terminalId } : {}),
  };
}

function buildActivity(
  channel: string,
  phase: IpcActivity['phase'],
  direction: IpcActivity['direction'],
  payload: unknown,
  summary?: string,
  fallbackContext?: Pick<IpcActivity, 'taskId' | 'workspaceId' | 'sessionId' | 'terminalId'>,
): IpcActivity {
  const context = mergeContext(extractContextFromValue(payload), fallbackContext);
  const preview = safePreview(payload);
  const activity = {
    id: `ipc:${channel}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    channel,
    phase,
    direction,
    timestamp: Date.now(),
    ...context,
    ...(summary ? { summary } : {}),
    ...(preview ? { payloadPreview: preview } : {}),
  } satisfies IpcActivity;

  return enrichActivity(activity);
}

function emitInternalActivity(activity: IpcActivity): void {
  const listeners = internalListeners.get(IPC_ACTIVITY_CHANNEL);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    listener(activity);
  }
}

function addInternalListener(channel: string, callback: Listener): () => void {
  if (!internalListeners.has(channel)) {
    internalListeners.set(channel, new Set());
  }
  internalListeners.get(channel)!.add(callback);
  return () => {
    internalListeners.get(channel)?.delete(callback);
  };
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  invoke(channel: string, ...args: any[]): Promise<any> {
    const shouldTrace = shouldTraceInvokeChannel(channel);
    const requestContext = extractContextFromValue(args[0]);
    if (shouldTrace) {
      rememberContext(channel, args);
      emitInternalActivity(buildActivity(channel, 'request', 'renderer->main', args[0], extractSummary(channel, args[0])));
    }

    return ipcRenderer.invoke(channel, ...args)
      .then((result) => {
        if (shouldTrace) {
          rememberContext(channel, args, result);
          emitInternalActivity(buildActivity(channel, 'response', 'renderer->main', result, extractSummary(channel, result), requestContext));
        }
        return result;
      })
      .catch((error: unknown) => {
        if (shouldTrace) {
          const message = error instanceof Error ? error.message : String(error);
          emitInternalActivity(buildActivity(channel, 'error', 'renderer->main', args[0], truncate(message, 120), requestContext));
        }
        throw error;
      });
  },

  on(channel: string, callback: (...args: any[]) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => {
      if (channel === IPC_ACTIVITY_CHANNEL && args[0] && typeof args[0] === 'object') {
        callback(enrichActivity(args[0] as IpcActivity));
        return;
      }
      callback(...args);
    };

    if (!listenerMap.has(channel)) {
      listenerMap.set(channel, new Map());
    }

    const existing = listenerMap.get(channel)!.get(callback);
    if (existing) {
      ipcRenderer.removeListener(channel, existing);
    }
    listenerMap.get(channel)!.set(callback, listener);
    ipcRenderer.on(channel, listener);

    const removeInternal = channel === IPC_ACTIVITY_CHANNEL
      ? addInternalListener(channel, callback)
      : () => {};

    return () => {
      removeInternal();
      ipcRenderer.removeListener(channel, listener);
      listenerMap.get(channel)?.delete(callback);
    };
  },

  off(channel: string, callback: (...args: any[]) => void): void {
    internalListeners.get(channel)?.delete(callback);
    const listener = listenerMap.get(channel)?.get(callback) ?? callback;
    ipcRenderer.removeListener(channel, listener);
    listenerMap.get(channel)?.delete(callback);
  },
});
