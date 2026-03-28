/**
 * Shared shell-escaping utilities for SSH and remote command execution.
 *
 * All remote/SSH code should import from here instead of defining local copies.
 */

/** Escape single quotes inside a string (no wrapping quotes added). */
export function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Escape a value and wrap it in single quotes for safe shell interpolation. */
export function escapeShellArg(value: string): string {
  return `'${escapeShell(value)}'`;
}

/**
 * Convert a path to a shell-safe remote path, expanding `~` to `$HOME`.
 * Use this when building SSH commands that reference remote file paths.
 */
export function toRemoteShellPath(value: string): string {
  const trimmed = value.trim() || '~';
  if (trimmed === '~') return '"$HOME"';
  if (trimmed.startsWith('~/')) {
    const rest = trimmed.slice(2);
    return rest ? `"$HOME"/${escapeShellArg(rest)}` : '"$HOME"';
  }
  return escapeShellArg(trimmed);
}
