import { useUiStore, type RecentProject } from '../stores/ui';

function basename(value: string): string {
  return value.split('/').pop() || value.split('\\').pop() || value;
}

export function createRecentProject(
  path: string,
  options?: { isSSH?: boolean; sshHost?: string | null; lastOpened?: number },
): RecentProject {
  return {
    path,
    name: basename(path),
    lastOpened: options?.lastOpened ?? Date.now(),
    ...(options?.isSSH ? { isSSH: true, sshHost: options.sshHost ?? undefined } : {}),
  };
}

export async function rememberRecentProject(project: RecentProject): Promise<void> {
  useUiStore.getState().addRecentProject(project);
  await window.api.invoke('config:set', { recentProjects: useUiStore.getState().recentProjects });
}

export async function connectToSshWorkspace(
  host: string,
  remoteCwd?: string,
): Promise<{ host: string; cwd: string }> {
  const result = await window.api.invoke('ssh:connect', {
    host,
    remoteCwd,
  }) as { connected: boolean; cwd: string; host?: string };

  const resolvedHost = result.host ?? host;
  const resolvedCwd = result.cwd ?? remoteCwd ?? '';
  const ui = useUiStore.getState();
  ui.setSshHost(resolvedHost);
  ui.setSshConnected(true);
  ui.setCwd(resolvedCwd);
  return { host: resolvedHost, cwd: resolvedCwd };
}

export async function disconnectFromSshWorkspace(): Promise<{ cwd?: string }> {
  const result = await window.api.invoke('ssh:disconnect') as { cwd?: string };
  const ui = useUiStore.getState();
  ui.setSshHost(null);
  ui.setSshConnected(false);
  if (result?.cwd) {
    ui.setCwd(result.cwd);
  }
  return result;
}
