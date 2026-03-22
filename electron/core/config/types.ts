import type { ThinkingLevel } from '../agents/types';

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  isSSH?: boolean;
  sshHost?: string;
}

export interface RecentSshHost {
  host: string;
  remotePath: string;
  lastUsed: number;
}

export interface RepoMapConfig {
  enabled: boolean;
  maxTokens: number;
  indexedFilePatterns: string[];
  excludePatterns: string[];
  perAgentEnabled: Record<string, boolean>;
  autoRefresh: boolean;
}

export interface FluxConfig {
  theme: 'light' | 'dark';
  fontSize: number;
  sendKey: 'enter' | 'cmd+enter';
  preferredIde?: 'code' | 'cursor' | 'zed';
  defaultAgent: string;
  defaultModel: string;
  subagentModel?: string;
  defaultThinking: ThinkingLevel;
  defaultMode: 'plan' | 'act';
  qualityGateCommands: string[];
  qualityGateMaxRetries: number;
  customAgentPaths: Record<string, string>;
  recentProjects: RecentProject[];
  recentSshHosts: RecentSshHost[];
  zoomLevel?: number;
  defaultMergeAgent?: string;
  defaultMergeModel?: string;
  defaultMergeThinking?: ThinkingLevel;
  repoMap: RepoMapConfig;
  defaultMergeAgent?: string;
  defaultMergeModel?: string;
  defaultMergeThinking?: ThinkingLevel;
}
