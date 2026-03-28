import type { ThinkingLevel } from '../agents/types';

export type ProjectSourceKind = 'local' | 'ssh';

export interface ProjectSource {
  path: string;
  source: ProjectSourceKind;
  sshHost?: string;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  source: ProjectSourceKind;
  sshHost?: string;
}

export interface RecentSshHost {
  host: string;
  remotePath: string;
  lastUsed: number;
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
  quickCreateDirect?: boolean;
  qualityGateCommands: string[];
  qualityGateMaxRetries: number;
  customAgentPaths: Record<string, string>;
  recentProjects: RecentProject[];
  recentSshHosts: RecentSshHost[];
  zoomLevel?: number;
  defaultMergeAgent?: string;
  defaultMergeModel?: string;
  defaultMergeThinking?: ThinkingLevel;
  lastActiveGroupId?: string;
  openProjects?: ProjectSource[];
  activeProject?: ProjectSource;
  activeProjectPath?: string;
}
