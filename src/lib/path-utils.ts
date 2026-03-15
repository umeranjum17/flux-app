export function normalizeTrackedFilePath(filePath: string, cwd?: string): string {
  const raw = filePath.trim();
  if (!raw) return raw;

  let normalized = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  normalized = normalized.replace(/^\.\//, '');

  if (cwd) {
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized.startsWith(`${normalizedCwd}/`)) {
      normalized = normalized.slice(normalizedCwd.length + 1);
    }
  }

  return normalized;
}

export function getDisplayPath(path: string): { basename: string; context: string } {
  const normalized = normalizeTrackedFilePath(path);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { basename: path, context: '' };
  }

  const basename = parts[parts.length - 1];
  const contextParts = parts.slice(0, -1);
  const context =
    contextParts.length <= 3
      ? contextParts.join('/')
      : `.../${contextParts.slice(-3).join('/')}`;

  return { basename, context };
}
