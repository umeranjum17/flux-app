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
  defaultAgent: string;
  defaultModel: string;
  subagentModel?: string;
  defaultThinking: ThinkingLevel;
  defaultMode: 'plan' | 'act';
  qualityGateCommands: string[];
  customAgentPaths: Record<string, string>;
  recentProjects: RecentProject[];
  recentSshHosts: RecentSshHost[];
  repoMap: RepoMapConfig;
}
