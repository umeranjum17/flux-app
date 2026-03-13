import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { FluxConfig } from './types';

const DEFAULT_REPOMAP_CONFIG: FluxConfig['repoMap'] = {
  enabled: false,
  maxTokens: 2048,
  indexedFilePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.vite/**', '__pycache__/**'],
  perAgentEnabled: {},
  autoRefresh: true,
};

const DEFAULT_CONFIG: FluxConfig = {
  theme: 'dark',
  fontSize: 14,
  sendKey: 'cmd+enter',
  defaultAgent: 'claude-code',
  defaultModel: 'sonnet',
  subagentModel: 'haiku',
  defaultThinking: 'medium',
  defaultMode: 'act',
  qualityGateCommands: [],
  customAgentPaths: {},
  zoomLevel: 1.0,
  recentProjects: [],
  recentSshHosts: [],
  repoMap: DEFAULT_REPOMAP_CONFIG,
};

function normalizeConfig(raw: Record<string, unknown>): FluxConfig {
  const theme = raw.theme === 'light' ? 'light' : 'dark';
  const sendKey = raw.sendKey === 'enter' ? 'enter' : 'cmd+enter';
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

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    theme,
    sendKey,
    defaultThinking,
    defaultMode,
    subagentModel: typeof raw.subagentModel === 'string' ? raw.subagentModel : DEFAULT_CONFIG.subagentModel,
    customAgentPaths:
      raw.customAgentPaths && typeof raw.customAgentPaths === 'object' && !Array.isArray(raw.customAgentPaths)
        ? raw.customAgentPaths as FluxConfig['customAgentPaths']
        : DEFAULT_CONFIG.customAgentPaths,
    recentProjects: Array.isArray(raw.recentProjects)
      ? raw.recentProjects as FluxConfig['recentProjects']
      : DEFAULT_CONFIG.recentProjects,
    recentSshHosts: Array.isArray(raw.recentSshHosts)
      ? raw.recentSshHosts as FluxConfig['recentSshHosts']
      : DEFAULT_CONFIG.recentSshHosts,
    zoomLevel: typeof raw.zoomLevel === 'number'
      ? Math.max(0.5, Math.min(2.5, raw.zoomLevel))
      : DEFAULT_CONFIG.zoomLevel,
    repoMap: raw.repoMap && typeof raw.repoMap === 'object' && !Array.isArray(raw.repoMap)
      ? { ...DEFAULT_REPOMAP_CONFIG, ...(raw.repoMap as Record<string, unknown>) } as FluxConfig['repoMap']
      : DEFAULT_REPOMAP_CONFIG,
  };
}

function getConfigPath(): string {
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(homeDir, '.flux', 'config.json');
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
    const merged = { ...current, ...partial };

    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  }
}
