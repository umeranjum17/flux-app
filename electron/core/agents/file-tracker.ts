import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * FileTracker snapshots file contents before mutations and synthesizes
 * unified diffs after tool calls complete. This gives visibility into
 * file changes even when agents don't explicitly report diffs.
 */
export class FileTracker {
  private snapshots = new Map<string, string | null>();

  /**
   * Snapshot the current content of a file before it gets mutated.
   * Falls back to `git show HEAD:<path>` if the file doesn't exist yet on disk.
   */
  snapshotBefore(filePath: string, cwd: string): void {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

    // Don't re-snapshot if we already have one
    if (this.snapshots.has(resolved)) return;

    let content: string | null = null;

    try {
      content = fs.readFileSync(resolved, 'utf-8');
    } catch {
      // File doesn't exist on disk — try git
      try {
        const relative = path.relative(cwd, resolved);
        content = execFileSync('git', ['show', `HEAD:${relative}`], {
          cwd,
          encoding: 'utf-8',
          timeout: 5000,
        });
      } catch {
        // File is brand new
        content = null;
      }
    }

    this.snapshots.set(resolved, content);
  }

  /**
   * After a tool call completes, read the current file content and
   * synthesize a unified diff against the snapshot.
   */
  synthesizeDiff(filePath: string, cwd: string): string | null {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const before = this.snapshots.get(resolved);

    let after: string | null = null;
    try {
      after = fs.readFileSync(resolved, 'utf-8');
    } catch {
      // File was deleted
      after = null;
    }

    // No change
    if (before === after) return null;

    // Remove snapshot after use
    this.snapshots.delete(resolved);

    return buildUnifiedDiff(
      filePath,
      before ?? '',
      after ?? '',
      before === null,
      after === null,
    );
  }

  /**
   * Track a tool call that might modify files.
   * Call this BEFORE the tool executes.
   */
  trackToolCall(toolName: string, toolInput: Record<string, unknown>, cwd: string): void {
    const name = toolName.toLowerCase();

    // Detect file-modifying tools
    if (name.includes('write') || name.includes('edit') || name.includes('patch')) {
      const filePath = (toolInput.file_path ?? toolInput.path ?? toolInput.filePath) as string | undefined;
      if (filePath) {
        this.snapshotBefore(filePath, cwd);
      }
    }

    // Bash commands that might modify files — snapshot known patterns
    if (name.includes('bash') || name.includes('command') || name.includes('shell')) {
      const cmd = String(toolInput.command ?? '');
      // Extract file paths from common write patterns
      const writePatterns = [
        />\s*["']?([^\s"'|&;]+)/,     // redirect: > file
        /tee\s+["']?([^\s"'|&;]+)/,   // tee file
        /mv\s+\S+\s+["']?([^\s"'|&;]+)/, // mv src dest
        /cp\s+\S+\s+["']?([^\s"'|&;]+)/, // cp src dest
      ];
      for (const pattern of writePatterns) {
        const match = cmd.match(pattern);
        if (match?.[1]) {
          this.snapshotBefore(match[1], cwd);
        }
      }
    }
  }

  /**
   * After a tool call completes, resolve any tracked files and return
   * a file_edit message if changes were detected.
   */
  resolveToolResult(
    toolName: string,
    toolInput: Record<string, unknown>,
    cwd: string,
  ): { filePath: string; diff: string } | null {
    const name = toolName.toLowerCase();

    let filePath: string | undefined;

    if (name.includes('write') || name.includes('edit') || name.includes('patch')) {
      filePath = (toolInput.file_path ?? toolInput.path ?? toolInput.filePath) as string | undefined;
    }

    if (!filePath) return null;

    const diff = this.synthesizeDiff(filePath, cwd);
    if (!diff) return null;

    return { filePath, diff };
  }

  /**
   * Clear all snapshots (e.g., when task ends).
   */
  clear(): void {
    this.snapshots.clear();
  }
}

/**
 * Build a minimal unified diff from before/after content.
 */
function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  isNew: boolean,
  isDeleted: boolean,
): string {
  const header = [
    `--- ${isNew ? '/dev/null' : `a/${filePath}`}`,
    `+++ ${isDeleted ? '/dev/null' : `b/${filePath}`}`,
  ];

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  // Simple diff: show context around changes
  const hunks: string[] = [];
  let i = 0;
  let j = 0;
  const contextSize = 3;

  // For small files or complete replacements, just show the whole thing
  if (beforeLines.length <= 20 && afterLines.length <= 20) {
    hunks.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
    for (const line of beforeLines) {
      if (line || beforeLines.length > 1) hunks.push(`-${line}`);
    }
    for (const line of afterLines) {
      if (line || afterLines.length > 1) hunks.push(`+${line}`);
    }
  } else {
    // For larger files, find changed regions
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    let inChange = false;
    let changeStart = -1;

    for (let k = 0; k < maxLen + 1; k++) {
      const bLine = k < beforeLines.length ? beforeLines[k] : undefined;
      const aLine = k < afterLines.length ? afterLines[k] : undefined;
      const same = bLine === aLine && bLine !== undefined;

      if (!same && !inChange) {
        inChange = true;
        changeStart = Math.max(0, k - contextSize);
        // Add context before
        for (let c = changeStart; c < k; c++) {
          if (c < beforeLines.length) hunks.push(` ${beforeLines[c]}`);
        }
      }

      if (same && inChange) {
        // End of change region - add trailing context
        const contextEnd = Math.min(k + contextSize, maxLen);
        for (let c = k; c < contextEnd && c < afterLines.length; c++) {
          hunks.push(` ${afterLines[c]}`);
        }
        inChange = false;
      }

      if (!same && inChange) {
        if (bLine !== undefined) hunks.push(`-${bLine}`);
        if (aLine !== undefined) hunks.push(`+${aLine}`);
      }
    }
  }

  if (hunks.length === 0) return '';

  return [...header, ...hunks].join('\n');
}
