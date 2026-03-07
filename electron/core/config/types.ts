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

export interface FluxConfig {
  theme: 'light' | 'dark';
  fontSize: number;
  sendKey: 'enter' | 'cmd+enter';
  defaultAgent: string;
  defaultModel: string;
  defaultThinking: ThinkingLevel;
  qualityGateCommands: string[];
  customAgentPaths: Record<string, string>;
  recentProjects: RecentProject[];
  recentSshHosts: RecentSshHost[];
}
