import type { Tag } from './types';

export interface FileGraph {
  adjacency: Map<string, Map<string, number>>;
  fileNodes: Set<string>;
}

/**
 * Build a directed file dependency graph from tags.
 *
 * Nodes = files (relative paths).
 * Edges = file A references an identifier defined in file B.
 * Edge weight = sum of multipliers for each shared identifier.
 */
export function buildGraph(
  allTags: Tag[],
  promptIdentifiers: Set<string>,
): FileGraph {
  // Index: identifier name -> files that define it, files that reference it
  const defIndex = new Map<string, Set<string>>();
  const refIndex = new Map<string, Set<string>>();
  const defCounts = new Map<string, number>();
  const fileNodes = new Set<string>();

  for (const tag of allTags) {
    fileNodes.add(tag.relPath);

    if (tag.kind === 'def') {
      if (!defIndex.has(tag.name)) defIndex.set(tag.name, new Set());
      defIndex.get(tag.name)!.add(tag.relPath);
      defCounts.set(tag.name, (defCounts.get(tag.name) ?? 0) + 1);
    } else {
      if (!refIndex.has(tag.name)) refIndex.set(tag.name, new Set());
      refIndex.get(tag.name)!.add(tag.relPath);
    }
  }

  // Build adjacency: referencing file -> defining file
  const adjacency = new Map<string, Map<string, number>>();

  for (const [name, refFiles] of refIndex) {
    const defFiles = defIndex.get(name);
    if (!defFiles) continue;

    // Compute weight multiplier for this identifier
    let weight = 1.0;

    // Boost identifiers mentioned in user prompt
    if (promptIdentifiers.has(name)) weight *= 10;

    // Boost long camelCase/snake_case identifiers (>=8 chars)
    if (name.length >= 8) weight *= 10;

    // Penalize private identifiers
    if (name.startsWith('_')) weight *= 0.1;

    // Penalize overused identifiers (>5 definitions)
    const totalDefs = defCounts.get(name) ?? 0;
    if (totalDefs > 5) weight *= 0.1;

    // Scale by sqrt of reference frequency
    weight *= Math.sqrt(refFiles.size);

    // Create edges from referencing files to defining files
    for (const refFile of refFiles) {
      for (const defFile of defFiles) {
        if (refFile === defFile) continue; // Skip self-references

        if (!adjacency.has(refFile)) adjacency.set(refFile, new Map());
        const edges = adjacency.get(refFile)!;
        edges.set(defFile, (edges.get(defFile) ?? 0) + weight);
      }
    }
  }

  return { adjacency, fileNodes };
}
