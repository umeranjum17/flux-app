import { describe, expect, it, vi } from 'vitest';

vi.mock('../../agents/manager', () => ({
  agentManager: {
    detectAll: vi.fn(),
  },
}));

vi.mock('../../worktree/diff', () => ({
  getChangedFiles: vi.fn(),
  getFileDiff: vi.fn(),
}));

vi.mock('../../workspace-group/store', () => ({
  WorkspaceGroupStore: vi.fn().mockImplementation(() => ({
    getGroupForWorkspace: vi.fn(),
  })),
}));

vi.mock('../utils', () => ({
  requireFields: vi.fn(),
  toStoredMessage: vi.fn(),
  buildStoredUserMessage: vi.fn(),
  buildUserMessagePayload: vi.fn(),
  buildPromptWithAttachments: vi.fn(),
  buildWorkspaceSystemContext: vi.fn(),
  extractLatestSessionAttachmentContext: vi.fn(),
  writeAttachmentContextFile: vi.fn(),
}));

import { listMulti } from '../operations';

describe('listMulti', () => {
  it('returns all workspaces when no parent repos are provided', () => {
    const allWorkspaces = [{ id: 'ws-1' }, { id: 'ws-2' }];
    const list = vi.fn((parentRepo?: string) => (parentRepo ? [] : allWorkspaces));
    const ctx = {
      workspaceStore: { list },
    } as any;

    expect(listMulti(ctx, [])).toEqual(allWorkspaces);
    expect(list).toHaveBeenCalledWith();
  });

  it('falls back to all workspaces when saved filters return nothing', () => {
    const allWorkspaces = [{ id: 'ws-1' }, { id: 'ws-2' }];
    const list = vi.fn((parentRepo?: string) => {
      if (!parentRepo) return allWorkspaces;
      return [];
    });
    const ctx = {
      workspaceStore: { list },
    } as any;

    expect(listMulti(ctx, ['/missing/repo'])).toEqual(allWorkspaces);
    expect(list).toHaveBeenCalledWith('/missing/repo');
    expect(list).toHaveBeenCalledWith();
  });
});
