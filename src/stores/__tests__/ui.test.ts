import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../ui';

beforeEach(() => {
  useUiStore.setState({
    sidebarOpen: true, theme: 'dark', sendKey: 'cmd+enter', mode: 'act', activeOverlay: null,
    cwd: '', projectName: '', gitBranch: null, gitDirty: false,
    explorerOpen: false, terminalOpen: false, activeTerminalId: null,
    bottomPanelMode: 'agent', bottomPanelOpen: false, bottomPanelTab: 'output', sshHost: null, sshConnected: false,
    environment: 'local', activeFile: null, pendingMention: null, recentProjects: [],
  });
});

describe('toggleSidebar', () => {
  it('flips sidebarOpen from true to false', () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it('flips sidebarOpen from false to true', () => {
    useUiStore.setState({ sidebarOpen: false });
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });
});

describe('toggleTheme', () => {
  it('flips dark to light', () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('light');
  });

  it('flips light to dark', () => {
    useUiStore.setState({ theme: 'light' });
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('dark');
  });
});

describe('setCwd', () => {
  it('sets cwd and derives projectName from basename', () => {
    useUiStore.getState().setCwd('/home/user/projects/my-app');
    const { cwd, projectName } = useUiStore.getState();
    expect(cwd).toBe('/home/user/projects/my-app');
    expect(projectName).toBe('my-app');
  });

  it('handles a single segment path', () => {
    useUiStore.getState().setCwd('my-app');
    expect(useUiStore.getState().projectName).toBe('my-app');
  });
});

describe('addRecentProject', () => {
  it('adds a project to the front of the list', () => {
    const project = { path: '/a', name: 'a', lastOpened: 1 };
    useUiStore.getState().addRecentProject(project);
    expect(useUiStore.getState().recentProjects).toEqual([project]);
  });

  it('deduplicates by project identity, keeping the newer entry at front', () => {
    const old = { path: '/a', name: 'a', lastOpened: 1 };
    const updated = { path: '/a', name: 'a', lastOpened: 2 };
    useUiStore.getState().addRecentProject(old);
    useUiStore.getState().addRecentProject(updated);
    const list = useUiStore.getState().recentProjects;
    expect(list).toHaveLength(1);
    expect(list[0].lastOpened).toBe(2);
  });

  it('keeps local and SSH entries when they share the same path', () => {
    useUiStore.getState().addRecentProject({ path: '/repo', name: 'repo', lastOpened: 1 });
    useUiStore.getState().addRecentProject({
      path: '/repo',
      name: 'repo',
      lastOpened: 2,
      isSSH: true,
      sshHost: 'user@host',
    });

    const list = useUiStore.getState().recentProjects;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ path: '/repo', isSSH: true, sshHost: 'user@host' });
    expect(list[1]).toMatchObject({ path: '/repo', isSSH: undefined });
  });

  it('caps the list at 10 entries', () => {
    for (let i = 0; i < 12; i++) {
      useUiStore.getState().addRecentProject({ path: `/${i}`, name: `${i}`, lastOpened: i });
    }
    expect(useUiStore.getState().recentProjects).toHaveLength(10);
    // Most recently added should be first
    expect(useUiStore.getState().recentProjects[0].path).toBe('/11');
  });
});

describe('connectSsh / disconnectSsh', () => {
  it('connectSsh sets host, connected, environment, and cwd', () => {
    useUiStore.getState().connectSsh('user@host', '/remote/path');
    const { sshHost, sshConnected, environment, cwd } = useUiStore.getState();
    expect(sshHost).toBe('user@host');
    expect(sshConnected).toBe(true);
    expect(environment).toBe('ssh');
    expect(cwd).toBe('/remote/path');
  });

  it('disconnectSsh resets ssh state and restores local cwd', () => {
    useUiStore.getState().connectSsh('user@host', '/remote/path');
    useUiStore.getState().disconnectSsh('/local/path');
    const { sshHost, sshConnected, environment, cwd } = useUiStore.getState();
    expect(sshHost).toBeNull();
    expect(sshConnected).toBe(false);
    expect(environment).toBe('local');
    expect(cwd).toBe('/local/path');
  });
});

describe('setPendingMention', () => {
  it('sets a pending mention', () => {
    const mention = { path: '/src/index.ts', name: 'index.ts' };
    useUiStore.getState().setPendingMention(mention);
    expect(useUiStore.getState().pendingMention).toEqual(mention);
  });

  it('clears the pending mention with null', () => {
    useUiStore.setState({ pendingMention: { path: '/a', name: 'a' } });
    useUiStore.getState().setPendingMention(null);
    expect(useUiStore.getState().pendingMention).toBeNull();
  });
});

describe('toggleTerminal', () => {
  it('keeps bottom panel mode in sync when opening the terminal', () => {
    useUiStore.getState().toggleTerminal();
    expect(useUiStore.getState().terminalOpen).toBe(true);
    expect(useUiStore.getState().bottomPanelOpen).toBe(true);
    expect(useUiStore.getState().bottomPanelMode).toBe('terminal');
    expect(useUiStore.getState().bottomPanelTab).toBe('terminal');
  });

  it('switches from output to terminal before closing the panel', () => {
    useUiStore.setState({ bottomPanelOpen: true, bottomPanelTab: 'output', terminalOpen: false, bottomPanelMode: 'agent' });

    useUiStore.getState().toggleTerminal();

    expect(useUiStore.getState().bottomPanelOpen).toBe(true);
    expect(useUiStore.getState().bottomPanelTab).toBe('terminal');
    expect(useUiStore.getState().terminalOpen).toBe(true);
  });

  it('closes the panel when terminal is already active', () => {
    useUiStore.setState({ bottomPanelOpen: true, bottomPanelTab: 'terminal', terminalOpen: true, bottomPanelMode: 'terminal' });

    useUiStore.getState().toggleTerminal();

    expect(useUiStore.getState().bottomPanelOpen).toBe(false);
    expect(useUiStore.getState().terminalOpen).toBe(false);
    expect(useUiStore.getState().bottomPanelMode).toBe('agent');
  });
});

describe('setActiveFile', () => {
  it('tracks the active file preview separately from pending mentions', () => {
    const file = { path: '/src/App.tsx', name: 'App.tsx' };
    useUiStore.getState().setActiveFile(file);
    expect(useUiStore.getState().activeFile).toEqual(file);
    expect(useUiStore.getState().pendingMention).toBeNull();
  });
});
