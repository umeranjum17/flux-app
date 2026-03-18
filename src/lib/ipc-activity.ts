import type { IpcActivity } from './ipc-api';
import type { SystemActivity } from './types';

const DUPLICATE_RENDERED_EVENT_CHANNELS = new Set([
  'agent:message',
  'agent:done',
  'agent:permission',
  'agent:diff',
  'agent:todo',
  'agent:todo-update',
  'agent:stall',
  'workspace:status',
  'workspace:outcome',
  'workspace:checkpoint',
  'workspace:updated',
  'repomap:status',
]);

const HIGH_VOLUME_EVENT_CHANNELS = new Set([
  'terminal:data',
  'workspace:run-output',
  'workspace:diff-files',
  'workspace:diff-files-separated',
  'workspace:file-diff',
]);

function formatPhaseLabel(activity: IpcActivity): string {
  switch (activity.phase) {
    case 'request':
      return 'request';
    case 'response':
      return 'response';
    case 'error':
      return 'error';
    case 'event':
    default:
      return activity.direction === 'renderer->main' ? 'request' : 'event';
  }
}

function buildContextDetail(activity: IpcActivity): string[] {
  const parts = [formatPhaseLabel(activity)];
  if (activity.taskId) parts.push(`task ${activity.taskId}`);
  if (activity.workspaceId) parts.push(`workspace ${activity.workspaceId}`);
  if (activity.sessionId) parts.push(`session ${activity.sessionId}`);
  if (activity.terminalId) parts.push(`terminal ${activity.terminalId}`);
  if (activity.summary) parts.push(activity.summary);
  return parts;
}

export function shouldRenderIpcActivity(activity: IpcActivity): boolean {
  if (activity.direction === 'main->renderer' && DUPLICATE_RENDERED_EVENT_CHANNELS.has(activity.channel)) {
    return false;
  }
  if (HIGH_VOLUME_EVENT_CHANNELS.has(activity.channel)) {
    return false;
  }
  return true;
}

export function toSystemActivity(activity: IpcActivity): SystemActivity {
  return {
    id: activity.id,
    category: 'ipc',
    label: activity.channel,
    detail: buildContextDetail(activity).join(' · '),
    timestamp: activity.timestamp,
    channel: activity.channel,
    phase: activity.phase,
    direction: activity.direction,
    payloadPreview: activity.payloadPreview,
  };
}
