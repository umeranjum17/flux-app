import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<unknown> | unknown>();
const createWorkspaceFsMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown> | unknown) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../worktree/workspace-fs', () => ({
  createWorkspaceFs: createWorkspaceFsMock,
  createWorktreeAny: vi.fn(),
  removeWorktreeAny: vi.fn(),
}));

vi.mock('../../diagnostics/logger', () => ({
  logDiagnostic: vi.fn(),
}));

function buildContext() {
  const workspaceStore = {
    create: vi.fn((input: Record<string, unknown>) => ({
      createdAt: 1,
      updatedAt: 1,
      outcome: 'in_progress',
      status: 'idle',
      ...input,
    })),
    get: vi.fn(() => null),
    getIncludingMissing: vi.fn(() => null),
    list: vi.fn(() => []),
    delete: vi.fn(),
    update: vi.fn(),
    addSession: vi.fn(),
    listSessions: vi.fn(() => []),
  };

  return {
    configManager: { get: vi.fn(() => ({})) },
    workspaceStore,
    sendToRenderer: vi.fn(() => true),
    lifecycleManager: {
      setOutcome: vi.fn(),
      setStatus: vi.fn(),
      serialized: vi.fn(async (_workspaceId: string, fn: () => Promise<unknown>) => fn()),
      getActiveTaskIds: vi.fn(() => []),
      clearTask: vi.fn(),
      taskReleasedWithStatus: vi.fn(),
    },
    operationManager: {
      start: vi.fn(),
      cancel: vi.fn(),
      list: vi.fn(() => []),
    },
    remoteConnection: { host: null },
    spawnTaskRun: vi.fn(),
    releaseTask: vi.fn(),
  };
}

describe('registerWorkspaceHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    createWorkspaceFsMock.mockReset();
  });

  it('creates direct SSH workspaces using the remote filesystem abstraction', async () => {
    const mockFs = {
      exists: vi.fn().mockResolvedValue(true),
      git: vi.fn(async (_cwd: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
          return { stdout: '.git\n', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'main\n', stderr: '' };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }),
    };
    createWorkspaceFsMock.mockReturnValue(mockFs);

    const ctx = buildContext();
    const { registerWorkspaceHandlers } = await import('../workspace-handlers');
    registerWorkspaceHandlers(ctx as any);

    const handler = registeredHandlers.get('workspace:create-direct');
    expect(handler).toBeTypeOf('function');

    const created = await handler?.(null, {
      name: 'Remote Project',
      parentRepo: '/srv/app',
      agentId: 'codex',
      model: 'gpt-5.4',
      sshHost: 'dev@example',
    });

    expect(createWorkspaceFsMock).toHaveBeenCalledWith('dev@example');
    expect(mockFs.exists).toHaveBeenCalledWith('/srv/app');
    expect(ctx.workspaceStore.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Remote Project',
      parentRepo: '/srv/app',
      worktreePath: '/srv/app',
      branch: 'main',
      direct: true,
      sshHost: 'dev@example',
    }));
    expect(ctx.sendToRenderer).toHaveBeenCalledWith('workspace:created', { workspace: created });
  });

  it('initializes direct repos and resolves symbolic branch names when git is missing', async () => {
    const mockFs = {
      exists: vi.fn().mockResolvedValue(true),
      git: vi.fn(async (_cwd: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
          throw new Error('not a git repository');
        }
        if (args[0] === 'init') {
          return { stdout: 'Initialized empty Git repository\n', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { stdout: 'HEAD\n', stderr: '' };
        }
        if (args[0] === 'symbolic-ref') {
          return { stdout: 'trunk\n', stderr: '' };
        }
        throw new Error(`Unexpected git args: ${args.join(' ')}`);
      }),
    };
    createWorkspaceFsMock.mockReturnValue(mockFs);

    const ctx = buildContext();
    const { registerWorkspaceHandlers } = await import('../workspace-handlers');
    registerWorkspaceHandlers(ctx as any);

    const handler = registeredHandlers.get('workspace:create-direct');
    const created = await handler?.(null, {
      name: 'Fresh Repo',
      parentRepo: '/workspace/new-project',
      agentId: 'codex',
      model: 'gpt-5.4',
    });

    expect(createWorkspaceFsMock).toHaveBeenCalledWith(undefined);
    expect(mockFs.git).toHaveBeenCalledWith('/workspace/new-project', ['init'], { timeout: 10000 });
    expect(ctx.workspaceStore.create).toHaveBeenCalledWith(expect.objectContaining({
      branch: 'trunk',
      direct: true,
      sshHost: undefined,
    }));
    expect(created).toMatchObject({
      branch: 'trunk',
      direct: true,
    });
  });

  it('guides users toward Remote-SSH when opening an IDE for SSH workspaces', async () => {
    const ctx = buildContext();
    ctx.workspaceStore.get.mockReturnValue({
      id: 'ws-1',
      name: 'Remote Repo',
      parentRepo: '/srv/repo',
      worktreePath: '/srv/repo',
      branch: 'flux/remote-repo',
      agentId: 'codex',
      model: 'gpt-5.4',
      mode: 'act',
      status: 'idle',
      outcome: 'in_progress',
      sshHost: 'dev@example',
      createdAt: 1,
      updatedAt: 1,
    } as any);

    const { registerWorkspaceHandlers } = await import('../workspace-handlers');
    registerWorkspaceHandlers(ctx as any);

    const handler = registeredHandlers.get('workspace:open-ide');

    await expect(handler?.(null, { workspaceId: 'ws-1' })).rejects.toThrow(
      'Open this SSH workspace through Remote-SSH instead. Connect to dev@example',
    );
  });
});
