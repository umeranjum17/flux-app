import { describe, it, expect } from 'vitest';
import { computeNextOutcome, type WorkspaceGitState, type WorkspaceOutcomeTrigger } from '../outcome';
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
  // Terminal outcomes block all automated triggers
  // ---------------------------------------------------------------------------
  describe('terminal outcomes', () => {
    const terminalOutcomes: WorkspaceOutcome[] = ['merged', 'ready_to_merge', 'ready_to_archive'];
    const triggers: WorkspaceOutcomeTrigger[] = [
      'task_completed', 'task_completed_merge', 'task_error', 'agent_stopped', 'sync', 'unarchived',
    ];

    for (const outcome of terminalOutcomes) {
      for (const trigger of triggers) {
        // task_completed_merge is allowed to promote ready_to_merge → merged
        if (trigger === 'task_completed_merge' && outcome === 'ready_to_merge') continue;
        it(`${outcome} + ${trigger} → no change`, () => {
          expect(computeNextOutcome(outcome, trigger, git({ hasCommits: true, isMerged: true }))).toBeNull();
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // task_completed
  // ---------------------------------------------------------------------------
  describe('task_completed', () => {
    it('in_progress + hasCommits → ready_for_pr', () => {
      expect(computeNextOutcome('in_progress', 'task_completed', git({ hasCommits: true, hasPendingChanges: true }))).toBe('ready_for_pr');
    });

    it('in_progress + no commits → no change', () => {
      expect(computeNextOutcome('in_progress', 'task_completed', git())).toBeNull();
    });

    it('ready_for_pr + isMerged → merged', () => {
      expect(computeNextOutcome('ready_for_pr', 'task_completed', git({ isMerged: true }))).toBe('merged');
    });

    it('ready_for_pr + not merged → no change', () => {
      expect(computeNextOutcome('ready_for_pr', 'task_completed', git({ hasCommits: true }))).toBeNull();
    });
  });

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

    it('ready_to_merge + not merged → no change (already at ready_for_pr or above)', () => {
      expect(computeNextOutcome('ready_to_merge', 'task_completed_merge', git())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // task_error — should never promote
  // ---------------------------------------------------------------------------
  describe('task_error', () => {
    it('in_progress + hasCommits → no change (error does not promote)', () => {
      expect(computeNextOutcome('in_progress', 'task_error', git({ hasCommits: true }))).toBeNull();
    });

    it('ready_for_pr + any → no change', () => {
      expect(computeNextOutcome('ready_for_pr', 'task_error', git({ isMerged: true }))).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // agent_stopped
  // ---------------------------------------------------------------------------
  describe('agent_stopped', () => {
    it('in_progress + hasCommits → ready_for_pr', () => {
      expect(computeNextOutcome('in_progress', 'agent_stopped', git({ hasCommits: true, hasPendingChanges: true }))).toBe('ready_for_pr');
    });

    it('in_progress + no commits → no change', () => {
      expect(computeNextOutcome('in_progress', 'agent_stopped', git())).toBeNull();
    });

    it('ready_for_pr + any → no change', () => {
      expect(computeNextOutcome('ready_for_pr', 'agent_stopped', git({ hasCommits: true }))).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // sync
  // ---------------------------------------------------------------------------
  describe('sync', () => {
    it('any + isMerged → merged', () => {
      expect(computeNextOutcome('in_progress', 'sync', git({ isMerged: true }))).toBe('merged');
      expect(computeNextOutcome('ready_for_pr', 'sync', git({ isMerged: true }))).toBe('merged');
    });

    it('in_progress + hasPendingChanges → ready_for_pr', () => {
      expect(computeNextOutcome('in_progress', 'sync', git({ hasCommits: true, hasPendingChanges: true }))).toBe('ready_for_pr');
    });

    it('ready_for_pr + no pending changes → in_progress', () => {
      expect(computeNextOutcome('ready_for_pr', 'sync', git())).toBe('in_progress');
    });

    it('in_progress + no changes → no change', () => {
      expect(computeNextOutcome('in_progress', 'sync', git())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // unarchived
  // ---------------------------------------------------------------------------
  describe('unarchived', () => {
    it('in_progress + isMerged → merged', () => {
      expect(computeNextOutcome('in_progress', 'unarchived', git({ isMerged: true }))).toBe('merged');
    });

    it('in_progress + not merged → no change', () => {
      expect(computeNextOutcome('in_progress', 'unarchived', git())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // THE BUG: empty branch should NOT show as merged
  // ---------------------------------------------------------------------------
  describe('empty branch (root cause bug)', () => {
    it('empty branch (no commits, not merged) stays in_progress on sync', () => {
      // This is the critical case: a fresh workspace with zero commits.
      // isMerged should be false (fixed in isWorkspaceBranchMerged).
      // The state machine should NOT transition to merged.
      expect(computeNextOutcome('in_progress', 'sync', git())).toBeNull();
    });

    it('empty branch stays in_progress on task_completed', () => {
      expect(computeNextOutcome('in_progress', 'task_completed', git())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Git state with warnings (error paths)
  // ---------------------------------------------------------------------------
  describe('git state warnings', () => {
    it('warnings field is carried through without affecting pure transition', () => {
      // computeNextOutcome itself doesn't check warnings — callers do
      const state = git({ hasCommits: true, hasPendingChanges: true, warnings: ['git error'] });
      expect(computeNextOutcome('in_progress', 'task_completed', state)).toBe('ready_for_pr');
    });

    it('worktreeDeleted flag is carried on git state', () => {
      const state = git({ worktreeDeleted: true, warnings: ['Worktree missing'] });
      // Pure function still computes based on hasCommits/isMerged, which are false
      expect(computeNextOutcome('in_progress', 'sync', state)).toBeNull();
    });

    it('worktreeDeleted with ready_for_pr stays unchanged (pure function)', () => {
      // The sync trigger would demote ready_for_pr → in_progress when hasPendingChanges is false
      // This is where the demotion guard in transitionWorkspaceOutcome kicks in
      const state = git({ worktreeDeleted: true, warnings: ['Worktree missing'] });
      expect(computeNextOutcome('ready_for_pr', 'sync', state)).toBe('in_progress');
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
// transitionWorkspaceOutcome demotion guard
// ---------------------------------------------------------------------------
describe('transitionWorkspaceOutcome', () => {
  it('skips demotion when git state has warnings', async () => {
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
    // computeNextOutcome would want to demote ready_for_pr → in_progress
    // but the demotion guard should prevent it
    await transitionWorkspaceOutcome(workspace, 'sync', emitFn);
    expect(emittedOutcome).toBeNull();
  });
});
