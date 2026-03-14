function randomSuffix(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

export function generateWorkspaceName(now = new Date()): string {
  const dateCode = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `workspace-${dateCode}-${randomSuffix()}`;
}
