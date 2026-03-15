import { describe, it, expect } from 'vitest';
import { computeNextOutcome, type WorkspaceGitState, type WorkspaceOutcomeTrigger } from '../outcome';
import type { WorkspaceOutcome } from '../types';

function git(overrides: Partial<WorkspaceGitState> = {}): WorkspaceGitState {
  return {
    hasCommits: false,
    hasUncommittedChanges: false,
    hasPendingChanges: false,
    isMerged: false,
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
});
