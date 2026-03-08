import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface RepoMapConfig {
  enabled: boolean;
  maxTokens: number;
  indexedFilePatterns: string[];
  excludePatterns: string[];
  perAgentEnabled: Record<string, boolean>;
  autoRefresh: boolean;
}

export interface MapStatus {
  state: 'idle' | 'building' | 'ready' | 'error';
  totalFiles: number;
  parsedFiles: number;
  totalTags: number;
  lastBuiltAt: number | null;
  errorMessage?: string;
}

interface IntelligenceState {
  config: RepoMapConfig;
  status: MapStatus;

  setConfig(config: RepoMapConfig): void;
  updateConfig(partial: Partial<RepoMapConfig>): void;
  setStatus(status: MapStatus): void;

  loadConfig(): Promise<void>;
  saveConfig(config: Partial<RepoMapConfig>): Promise<void>;
  rebuild(): Promise<void>;
  preview(prompt: string): Promise<string>;
}

const defaultConfig: RepoMapConfig = {
  enabled: false,
  maxTokens: 2048,
  indexedFilePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
  perAgentEnabled: {},
  autoRefresh: true,
};

const defaultStatus: MapStatus = {
  state: 'idle',
  totalFiles: 0,
  parsedFiles: 0,
  totalTags: 0,
  lastBuiltAt: null,
};

export const useIntelligenceStore = create<IntelligenceState>()(
  immer((set, get) => ({
    config: defaultConfig,
    status: defaultStatus,

    setConfig(config: RepoMapConfig) {
      set((s) => { s.config = config; });
    },

    updateConfig(partial: Partial<RepoMapConfig>) {
      set((s) => { s.config = { ...s.config, ...partial }; });
    },

    setStatus(status: MapStatus) {
      set((s) => { s.status = status; });
    },

    async loadConfig() {
      try {
        const config = await window.api.invoke('repomap:get-config') as RepoMapConfig;
        set((s) => { s.config = config; });
        const status = await window.api.invoke('repomap:get-status') as MapStatus;
        set((s) => { s.status = status; });
      } catch {
        // Use defaults
      }
    },

    async saveConfig(partial: Partial<RepoMapConfig>) {
      const merged = { ...get().config, ...partial };
      try {
        await window.api.invoke('repomap:set-config', merged);
        set((s) => { s.config = merged; });
      } catch {
        // Ignore save errors
      }
    },

    async rebuild() {
      try {
        await window.api.invoke('repomap:rebuild');
      } catch {
        // Ignore
      }
    },

    async preview(prompt: string) {
      try {
        return (await window.api.invoke('repomap:preview', { prompt })) as string;
      } catch {
        return '';
      }
    },
  })),
);
