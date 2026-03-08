import path from 'path';
import fg from 'fast-glob';
import type { Tag, RepoMapConfig, MapStatus } from './types';
import { DEFAULT_REPOMAP_CONFIG } from './types';
import { parseFile, invalidateFileCache, clearCache, getCacheSize } from './parser';
import { buildGraph } from './graph';
import { pagerank } from './pagerank';
import { formatRepoMap, fitTagsToTokenBudget } from './formatter';
import { startWatcher, stopWatcher } from './watcher';

class RepoMapService {
  private projectPath: string | null = null;
  private config: RepoMapConfig = { ...DEFAULT_REPOMAP_CONFIG };
  private status: MapStatus = {
    state: 'idle',
    totalFiles: 0,
    parsedFiles: 0,
    totalTags: 0,
    lastBuiltAt: null,
  };
  private allTags: Tag[] = [];
  private statusListeners: Array<(status: MapStatus) => void> = [];

  async init(projectPath: string, config: RepoMapConfig): Promise<void> {
    this.projectPath = projectPath;
    this.config = { ...config };

    if (!config.enabled) {
      this.status = { state: 'idle', totalFiles: 0, parsedFiles: 0, totalTags: 0, lastBuiltAt: null };
      return;
    }

    await this.rebuild();

    if (config.autoRefresh) {
      await startWatcher(projectPath, config, (filePath) => {
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);
        this.invalidateFile(absPath);
      });
    }
  }

  async rebuild(): Promise<void> {
    if (!this.projectPath) return;

    this.updateStatus({ state: 'building', parsedFiles: 0, totalTags: 0 });

    try {
      // Scan for matching files
      const files = await fg(this.config.indexedFilePatterns, {
        cwd: this.projectPath,
        ignore: this.config.excludePatterns,
        absolute: true,
        dot: false,
      });

      this.updateStatus({ totalFiles: files.length });

      // Parse all files
      const allTags: Tag[] = [];
      let parsed = 0;

      for (const file of files) {
        const tags = await parseFile(file, this.projectPath);
        allTags.push(...tags);
        parsed++;

        // Update status every 50 files
        if (parsed % 50 === 0) {
          this.updateStatus({ parsedFiles: parsed, totalTags: allTags.length });
        }
      }

      this.allTags = allTags;
      this.updateStatus({
        state: 'ready',
        parsedFiles: parsed,
        totalTags: allTags.length,
        lastBuiltAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: 'error', errorMessage: message });
    }
  }

  async getMap(prompt: string, maxTokens?: number): Promise<string> {
    if (!this.projectPath || this.allTags.length === 0) return '';

    const tokenBudget = maxTokens ?? this.config.maxTokens;

    // Extract identifiers from prompt for personalization
    const promptIdentifiers = extractIdentifiers(prompt);

    // Build file dependency graph
    const graph = buildGraph(this.allTags, promptIdentifiers);

    // Build personalization vector: boost files whose identifiers appear in prompt
    const personalization = new Map<string, number>();
    for (const tag of this.allTags) {
      if (promptIdentifiers.has(tag.name)) {
        personalization.set(tag.relPath, (personalization.get(tag.relPath) ?? 0) + 1);
      }
    }

    // Run PageRank
    const ranks = pagerank(graph.adjacency, graph.fileNodes, personalization);

    // Get definition tags only, sorted by their file's rank
    const defTags = this.allTags.filter((t) => t.kind === 'def');

    // Deduplicate: keep unique (relPath, name) combinations
    const seen = new Set<string>();
    const uniqueDefTags = defTags.filter((t) => {
      const key = `${t.relPath}:${t.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by PageRank score (descending)
    uniqueDefTags.sort((a, b) => {
      const rankA = ranks.get(a.relPath) ?? 0;
      const rankB = ranks.get(b.relPath) ?? 0;
      return rankB - rankA;
    });

    // Binary search for max tags that fit in token budget
    const fittedTags = fitTagsToTokenBudget(uniqueDefTags, tokenBudget);

    return formatRepoMap(fittedTags, tokenBudget);
  }

  invalidateFile(absPath: string): void {
    invalidateFileCache(absPath);

    // Remove old tags for this file and re-parse
    if (this.projectPath) {
      this.allTags = this.allTags.filter((t) => t.absPath !== absPath);

      // Re-parse asynchronously
      parseFile(absPath, this.projectPath).then((newTags) => {
        this.allTags.push(...newTags);
        this.updateStatus({ totalTags: this.allTags.length, lastBuiltAt: Date.now() });
      }).catch(() => {
        // File may have been deleted — that's fine
      });
    }
  }

  getStatus(): MapStatus {
    return { ...this.status };
  }

  getConfig(): RepoMapConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<RepoMapConfig>): void {
    this.config = { ...this.config, ...config };
  }

  onStatusChange(listener: (status: MapStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  async shutdown(): Promise<void> {
    await stopWatcher();
    clearCache();
    this.allTags = [];
    this.statusListeners = [];
    this.updateStatus({ state: 'idle', totalFiles: 0, parsedFiles: 0, totalTags: 0, lastBuiltAt: null });
  }

  private updateStatus(partial: Partial<MapStatus>): void {
    this.status = { ...this.status, ...partial };
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

function extractIdentifiers(text: string): Set<string> {
  const ids = new Set<string>();
  // Match word-like identifiers (camelCase, snake_case, PascalCase)
  const pattern = /\b([a-zA-Z_]\w{2,})\b/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return ids;
}

// Singleton
export const repoMapService = new RepoMapService();
