import { describe, it, expect } from 'vitest';
import { getWorkspaceLifecycleState, getWorkspaceListSignal } from '../workspace-status';

describe('getWorkspaceLifecycleState', () => {
  it('returns merged for outcome merged', () => {
    expect(getWorkspaceLifecycleState({ status: 'done', outcome: 'merged' })).toBe('merged');
  });

  it('returns ready_to_archive for outcome ready_to_archive', () => {
    expect(getWorkspaceLifecycleState({ status: 'done', outcome: 'ready_to_archive' })).toBe('ready_to_archive');
  });

  it('returns ready_to_merge for outcome ready_to_merge', () => {
    expect(getWorkspaceLifecycleState({ status: 'done', outcome: 'ready_to_merge' })).toBe('ready_to_merge');
  });

  it('returns idle for in_progress outcome with idle status', () => {
    expect(getWorkspaceLifecycleState({ status: 'idle', outcome: 'in_progress' })).toBe('idle');
  });

  it('returns blocked for error status regardless of outcome', () => {
    expect(getWorkspaceLifecycleState({ status: 'error', outcome: 'ready_for_pr' })).toBe('blocked');
  });
});

describe('getWorkspaceListSignal', () => {
  it('returns ready_to_archive signal state and dot class', () => {
    const signal = getWorkspaceListSignal({ name: 'test', status: 'done', outcome: 'ready_to_archive' });
    expect(signal.state).toBe('ready_to_archive');
    expect(signal.dotClassName).toContain('workspace-list-signal-ready-to-archive');
    expect(signal.label).toBe('Ready to archive');
  });

  it('returns merged signal state for merged outcome', () => {
    const signal = getWorkspaceListSignal({ name: 'test', status: 'done', outcome: 'merged' });
    expect(signal.state).toBe('merged');
    expect(signal.dotClassName).toContain('workspace-list-signal-complete');
  });
});
