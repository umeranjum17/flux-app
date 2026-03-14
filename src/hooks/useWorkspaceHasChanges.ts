import { useEffect, useState } from 'react';

interface UseWorkspaceHasChangesOptions {
  fallback?: boolean;
  pollMs?: number | null;
}

export function useWorkspaceHasChanges(
  workspaceId: string | undefined,
  options?: UseWorkspaceHasChangesOptions,
): boolean {
  const fallback = options?.fallback ?? false;
  const pollMs = options?.pollMs ?? null;
  const [hasChanges, setHasChanges] = useState<boolean>(fallback);

  useEffect(() => {
    if (!workspaceId) {
      setHasChanges(fallback);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId });
        if (!cancelled) {
          setHasChanges(files.length > 0);
        }
      } catch {
        if (!cancelled) {
          setHasChanges(fallback);
        }
      }
    };

    refresh();
    const interval = pollMs && pollMs > 0
      ? window.setInterval(refresh, pollMs)
      : null;

    return () => {
      cancelled = true;
      if (interval != null) {
        window.clearInterval(interval);
      }
    };
  }, [workspaceId, fallback, pollMs]);

  return hasChanges;
}
