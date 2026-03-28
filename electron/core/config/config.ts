import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { FluxConfig } from './types';

const DEFAULT_CONFIG: FluxConfig = {
  theme: 'dark',
  fontSize: 14,
  sendKey: 'cmd+enter',
  preferredIde: 'code',
  defaultAgent: 'claude-code',
  defaultModel: 'sonnet',
  subagentModel: 'haiku',
  defaultThinking: 'medium',
  defaultMode: 'act',
  quickCreateDirect: false,
  qualityGateCommands: [],
  qualityGateMaxRetries: 2,
  customAgentPaths: {},
  zoomLevel: 1.0,
  recentProjects: [],
  recentSshHosts: [],
};

function normalizeProjectSource(value: unknown): NonNullable<FluxConfig['openProjects']>[number] | null {
  if (typeof value === 'string') {
    return { path: value, source: 'local' };
  }

  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string' || value.path.length === 0) {
    return null;
  }

  const source =
    ('source' in value && value.source === 'ssh') || ('isSSH' in value && value.isSSH === true)
      ? 'ssh'
      : 'local';
  const sshHost = 'sshHost' in value && typeof value.sshHost === 'string' ? value.sshHost : undefined;

  return source === 'ssh'
    ? { path: value.path, source, ...(sshHost ? { sshHost } : {}) }
    : { path: value.path, source };
}

function normalizeProjectSources(value: unknown): FluxConfig['openProjects'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const deduped = new Map<string, NonNullable<FluxConfig['openProjects']>[number]>();
  for (const item of value) {
    const normalized = normalizeProjectSource(item);
    if (!normalized) continue;
    const key = normalized.source === 'ssh'
      ? `ssh:${normalized.sshHost ?? ''}:${normalized.path}`
      : `local:${normalized.path}`;
    deduped.set(key, normalized);
  }

  return Array.from(deduped.values());
}

function normalizeRecentProjects(value: unknown): FluxConfig['recentProjects'] {
  if (!Array.isArray(value)) {
    return DEFAULT_CONFIG.recentProjects;
  }

  return value.flatMap((item) => {
    const normalized = normalizeProjectSource(item);
    if (!normalized || typeof item !== 'object' || item === null) {
      return [];
    }

    const name = typeof item.name === 'string' && item.name.length > 0
      ? item.name
      : normalized.path.split('/').pop() || normalized.path.split('\\').pop() || normalized.path;
    const lastOpened = typeof item.lastOpened === 'number' ? item.lastOpened : Date.now();

    return [{
      ...normalized,
      name,
      lastOpened,
    }];
  });
}

function normalizeConfig(raw: Record<string, unknown>): FluxConfig {
  const theme = raw.theme === 'light' ? 'light' : 'dark';
  const sendKey = raw.sendKey === 'enter' ? 'enter' : 'cmd+enter';
  const preferredIde = raw.preferredIde === 'cursor' || raw.preferredIde === 'zed' || raw.preferredIde === 'code'
    ? raw.preferredIde
    : DEFAULT_CONFIG.preferredIde;
  const defaultThinking =
    raw.defaultThinking === 'low' ||
    raw.defaultThinking === 'medium' ||
    raw.defaultThinking === 'high' ||
    raw.defaultThinking === 'xhigh'
      ? raw.defaultThinking
      : raw.defaultThinking === true
        ? 'high'
        : DEFAULT_CONFIG.defaultThinking;

  const defaultMode = raw.defaultMode === 'plan' ? 'plan' : 'act';
  const quickCreateDirect = raw.quickCreateDirect === true;

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    theme,
    sendKey,
    preferredIde,
    defaultThinking,
    defaultMode,
    quickCreateDirect,
    subagentModel: typeof raw.subagentModel === 'string' ? raw.subagentModel : DEFAULT_CONFIG.subagentModel,
    customAgentPaths:
      raw.customAgentPaths && typeof raw.customAgentPaths === 'object' && !Array.isArray(raw.customAgentPaths)
        ? raw.customAgentPaths as FluxConfig['customAgentPaths']
        : DEFAULT_CONFIG.customAgentPaths,
    recentProjects: normalizeRecentProjects(raw.recentProjects),
    recentSshHosts: Array.isArray(raw.recentSshHosts)
      ? raw.recentSshHosts as FluxConfig['recentSshHosts']
      : DEFAULT_CONFIG.recentSshHosts,
    openProjects: normalizeProjectSources(raw.openProjects),
    activeProject: normalizeProjectSource(raw.activeProject)
      ?? (typeof raw.activeProjectPath === 'string' ? { path: raw.activeProjectPath, source: 'local' } : undefined),
    activeProjectPath: typeof raw.activeProjectPath === 'string'
      ? raw.activeProjectPath
      : undefined,
    lastActiveGroupId: typeof raw.lastActiveGroupId === 'string'
      ? raw.lastActiveGroupId
      : undefined,
    zoomLevel: typeof raw.zoomLevel === 'number'
      ? Math.max(0.5, Math.min(2.5, raw.zoomLevel))
      : DEFAULT_CONFIG.zoomLevel,
  };
}

function getConfigPath(): string {
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(homeDir, '.flux', 'config.json');
}

function mergeConfig(current: FluxConfig, partial: Partial<FluxConfig>): FluxConfig {
  const merged = {
    ...current,
    ...partial,
    customAgentPaths:
      partial.customAgentPaths && typeof partial.customAgentPaths === 'object' && !Array.isArray(partial.customAgentPaths)
        ? {
            ...current.customAgentPaths,
            ...partial.customAgentPaths,
          }
        : current.customAgentPaths,
  } satisfies Record<string, unknown>;

  return normalizeConfig(merged);
}

export class ConfigManager {
  get(): FluxConfig {
    const configPath = getConfigPath();

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return normalizeConfig(parsed);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  set(partial: Partial<FluxConfig>): void {
    const configPath = getConfigPath();
    const current = this.get();
    const merged = mergeConfig(current, partial);

    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf-8');
      fs.renameSync(tempPath, configPath);
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
  }
}
