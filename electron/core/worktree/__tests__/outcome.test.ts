import { describe, it, expect } from 'vitest';
import { computeNextOutcome, type WorkspaceGitState } from '../outcome';
import type { WorkspaceOutcome } from '../types';

function git(overrides: Partial<WorkspaceGitState> = {}): WorkspaceGitState {
  return {
    hasCommits: false,
    hasUncommittedChanges: false,
    hasPendingChanges: false,
    isMerged: false,
    warnings: [],
    ...overrides,
  };
}

describe('computeNextOutcome', () => {
  // ---------------------------------------------------------------------------
  // task_completed_merge
  // ---------------------------------------------------------------------------
  describe('task_completed_merge', () => {
    it('in_progress + isMerged → merged', () => {
      expect(computeNextOutcome('in_progress', 'task_completed_merge', git({ isMerged: true }))).toBe('merged');
    });

    it('in_progress + not merged → ready_for_pr', () => {
      expect(computeNextOutcome('in_progress', 'task_completed_merge', git())).toBe('ready_for_pr');
    });

    it('ready_for_pr + isMerged → merged', () => {
      expect(computeNextOutcome('ready_for_pr', 'task_completed_merge', git({ isMerged: true }))).toBe('merged');
    });

    it('ready_to_merge + isMerged → merged (bypasses terminal guard)', () => {
      expect(computeNextOutcome('ready_to_merge', 'task_completed_merge', git({ isMerged: true }))).toBe('merged');
    });

    it('ready_to_merge + not merged → no change', () => {
      expect(computeNextOutcome('ready_to_merge', 'task_completed_merge', git())).toBeNull();
    });

    it('merged → no change', () => {
      expect(computeNextOutcome('merged', 'task_completed_merge', git({ isMerged: true }))).toBeNull();
    });

    it('ready_to_archive → no change', () => {
      expect(computeNextOutcome('ready_to_archive', 'task_completed_merge', git({ isMerged: true }))).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // sync — only detects external merges
  // ---------------------------------------------------------------------------
  describe('sync', () => {
    it('any non-terminal + isMerged → merged', () => {
      const outcomes: WorkspaceOutcome[] = ['in_progress', 'planned', 'ready_for_pr', 'reviewing', 'changes_requested', 'ready_to_merge'];
      for (const outcome of outcomes) {
        expect(computeNextOutcome(outcome, 'sync', git({ isMerged: true }))).toBe('merged');
      }
    });

    it('already merged + isMerged → ready_to_archive', () => {
      expect(computeNextOutcome('merged', 'sync', git({ isMerged: true }))).toBe('ready_to_archive');
    });

    it('ready_to_archive → no change', () => {
      expect(computeNextOutcome('ready_to_archive', 'sync', git({ isMerged: true }))).toBeNull();
    });

    it('not merged → no change (sync no longer promotes/demotes)', () => {
      expect(computeNextOutcome('in_progress', 'sync', git({ hasCommits: true, hasPendingChanges: true }))).toBeNull();
      expect(computeNextOutcome('ready_for_pr', 'sync', git())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Empty branch should NOT show as merged
  // ---------------------------------------------------------------------------
  describe('empty branch (root cause bug)', () => {
    it('empty branch (no commits, not merged) stays unchanged on sync', () => {
      expect(computeNextOutcome('in_progress', 'sync', git())).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// resolveGitState
// ---------------------------------------------------------------------------
describe('resolveGitState', () => {
  it('returns worktreeDeleted when path does not exist', async () => {
    const { resolveGitState } = await import('../outcome');
    const workspace = {
      id: 'ws-test',
      worktreePath: '/nonexistent/path/that/does/not/exist',
      parentRepo: '/tmp',
      baseBranch: 'main',
    } as any;

    const state = await resolveGitState(workspace);
    expect(state.worktreeDeleted).toBe(true);
    expect(state.warnings.length).toBeGreaterThan(0);
    expect(state.hasCommits).toBe(false);
    expect(state.hasPendingChanges).toBe(false);
    expect(state.isMerged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transitionWorkspaceOutcome warning guard
// ---------------------------------------------------------------------------
describe('transitionWorkspaceOutcome', () => {
  it('skips transition when git state has warnings', async () => {
    const { transitionWorkspaceOutcome } = await import('../outcome');
    let emittedOutcome: string | null = null;
    const emitFn = (_id: string, outcome: string) => { emittedOutcome = outcome; };

    const workspace = {
      id: 'ws-test',
      outcome: 'ready_for_pr',
      worktreePath: '/nonexistent/path',
      parentRepo: '/tmp',
      baseBranch: 'main',
    } as any;

    // resolveGitState will return worktreeDeleted with warnings
    // Even if computeNextOutcome returns something, the warning guard prevents emission
    await transitionWorkspaceOutcome(workspace, 'sync', emitFn);
    expect(emittedOutcome).toBeNull();
  });
});
