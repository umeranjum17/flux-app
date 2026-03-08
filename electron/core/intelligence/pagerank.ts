/**
 * PageRank with personalization vector.
 * Power iteration implementation (~60 lines).
 */
export function pagerank(
  adjacency: Map<string, Map<string, number>>,
  nodes: Set<string>,
  personalization: Map<string, number>,
  damping = 0.85,
  maxIterations = 50,
  tolerance = 1e-6,
): Map<string, number> {
  const n = nodes.size;
  if (n === 0) return new Map();

  const nodeList = Array.from(nodes);
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < nodeList.length; i++) {
    nodeIndex.set(nodeList[i], i);
  }

  // Normalize personalization vector
  const persVec = new Float64Array(n);
  let persSum = 0;
  for (const [node, score] of personalization) {
    const idx = nodeIndex.get(node);
    if (idx !== undefined) {
      persVec[idx] = score;
      persSum += score;
    }
  }
  if (persSum > 0) {
    for (let i = 0; i < n; i++) persVec[i] /= persSum;
  } else {
    // Uniform personalization
    const uniform = 1 / n;
    for (let i = 0; i < n; i++) persVec[i] = uniform;
  }

  // Initialize ranks uniformly
  let ranks = new Float64Array(n);
  const initial = 1 / n;
  for (let i = 0; i < n; i++) ranks[i] = initial;

  // Precompute outgoing weights per node
  const outWeights = new Float64Array(n);
  const edges: Array<{ from: number; to: number; weight: number }> = [];

  for (const [fromNode, targets] of adjacency) {
    const fromIdx = nodeIndex.get(fromNode);
    if (fromIdx === undefined) continue;

    for (const [toNode, weight] of targets) {
      const toIdx = nodeIndex.get(toNode);
      if (toIdx === undefined) continue;
      edges.push({ from: fromIdx, to: toIdx, weight });
      outWeights[fromIdx] += weight;
    }
  }

  // Power iteration
  for (let iter = 0; iter < maxIterations; iter++) {
    const newRanks = new Float64Array(n);

    // Distribute rank through edges
    for (const { from, to, weight } of edges) {
      if (outWeights[from] > 0) {
        newRanks[to] += damping * ranks[from] * (weight / outWeights[from]);
      }
    }

    // Add personalization (teleportation)
    for (let i = 0; i < n; i++) {
      newRanks[i] += (1 - damping) * persVec[i];
    }

    // Check convergence
    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(newRanks[i] - ranks[i]);
    }

    ranks = newRanks;

    if (diff < tolerance) break;
  }

  // Convert back to Map
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(nodeList[i], ranks[i]);
  }

  return result;
}
