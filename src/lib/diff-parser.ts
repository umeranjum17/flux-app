import type { DiffFileEntry } from './types';

export interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk-header';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface ParsedHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

/** Parse a unified diff string into structured hunks with line numbers. */
export function parseUnifiedDiff(diff: string): ParsedHunk[] {
  const rawLines = diff.split('\n');
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawLines) {
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff ')) continue;

    const hunkMatch = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    if (hunkMatch) {
      current = {
        header: raw,
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);

      const ctx = hunkMatch[5]?.trim();
      if (ctx) {
        current.lines.push({ type: 'hunk-header', content: ctx });
      }
      continue;
    }

    if (!current) continue;

    if (raw.startsWith('+')) {
      current.lines.push({ type: 'added', content: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      current.lines.push({ type: 'removed', content: raw.slice(1), oldLine: oldLine++ });
    } else {
      current.lines.push({
        type: 'context',
        content: raw.startsWith(' ') ? raw.slice(1) : raw,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return hunks;
}

/** Convert a DiffFileEntry (from the store's DiffData) into ParsedHunks. */
export function diffFileEntryToHunks(entry: DiffFileEntry): ParsedHunk[] {
  return entry.hunks.map((hunk) => {
    const match = hunk.header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
    const oldStart = match ? parseInt(match[1], 10) : 1;
    const newStart = match ? parseInt(match[3], 10) : 1;
    const ctx = match?.[5]?.trim();

    let oLine = oldStart;
    let nLine = newStart;

    const lines: DiffLine[] = [];

    if (ctx) {
      lines.push({ type: 'hunk-header', content: ctx });
    }

    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lines.push({ type: 'added', content: line.slice(1), newLine: nLine++ });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        lines.push({ type: 'removed', content: line.slice(1), oldLine: oLine++ });
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line;
        lines.push({ type: 'context', content, oldLine: oLine++, newLine: nLine++ });
      }
    }

    return {
      header: hunk.header,
      oldStart,
      oldCount: parseInt(match?.[2] ?? '1', 10),
      newStart,
      newCount: parseInt(match?.[4] ?? '1', 10),
      lines,
    };
  });
}
