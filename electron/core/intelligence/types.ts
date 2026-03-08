export interface Tag {
  relPath: string;
  absPath: string;
  line: number;
  name: string;
  kind: 'def' | 'ref';
}

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

export const DEFAULT_REPOMAP_CONFIG: RepoMapConfig = {
  enabled: false,
  maxTokens: 2048,
  indexedFilePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.vite/**', '__pycache__/**'],
  perAgentEnabled: {},
  autoRefresh: true,
};
