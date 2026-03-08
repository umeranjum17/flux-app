import fs from 'fs';
import type { Tag } from './types';

/**
 * Format ranked definition tags into a context string with code snippets.
 * Groups by file, shows definition signatures.
 */
export function formatRepoMap(rankedTags: Tag[], maxTokens: number): string {
  if (rankedTags.length === 0) return '';

  // Group tags by file
  const fileGroups = new Map<string, Tag[]>();
  for (const tag of rankedTags) {
    if (!fileGroups.has(tag.relPath)) fileGroups.set(tag.relPath, []);
    fileGroups.get(tag.relPath)!.push(tag);
  }

  // Read source lines and format
  const blocks: string[] = [];
  let estimatedTokens = 0;
  const headerTokens = estimateTokens('<repository_map>\nBelow is a map of the most relevant definitions in this codebase, ranked by importance to your task.\n\n</repository_map>');

  estimatedTokens += headerTokens;

  for (const [relPath, tags] of fileGroups) {
    // Sort tags by line number within each file
    tags.sort((a, b) => a.line - b.line);

    // Read source file
    let lines: string[];
    try {
      const source = fs.readFileSync(tags[0].absPath, 'utf-8');
      lines = source.split('\n');
    } catch {
      continue;
    }

    // Build the file block
    const snippets: string[] = [];
    const seenLines = new Set<number>();

    for (const tag of tags) {
      if (seenLines.has(tag.line)) continue;
      seenLines.add(tag.line);

      // Get the definition line (and possibly the next line for context)
      const defLine = lines[tag.line];
      if (!defLine) continue;

      const truncated = defLine.length > 120 ? defLine.slice(0, 120) + '...' : defLine;
      snippets.push('  ' + truncated.trimEnd());
    }

    if (snippets.length === 0) continue;

    const block = `${relPath}:\n${snippets.join('\n')}`;
    const blockTokens = estimateTokens(block + '\n\n');

    if (estimatedTokens + blockTokens > maxTokens) break;

    estimatedTokens += blockTokens;
    blocks.push(block);
  }

  if (blocks.length === 0) return '';

  return `<repository_map>\nBelow is a map of the most relevant definitions in this codebase, ranked by importance to your task.\n\n${blocks.join('\n\n')}\n</repository_map>`;
}

/**
 * Estimate token count using char/4 approximation.
 * Fast and dependency-free.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Binary search for the maximum number of tags that fit within the token budget.
 */
export function fitTagsToTokenBudget(
  sortedTags: Tag[],
  maxTokens: number,
): Tag[] {
  if (sortedTags.length === 0) return [];

  // Binary search for the right number of tags
  let lo = 0;
  let hi = sortedTags.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const subset = sortedTags.slice(0, mid);
    const formatted = formatRepoMap(subset, Infinity);
    const tokens = estimateTokens(formatted);

    if (tokens <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return sortedTags.slice(0, lo);
}
