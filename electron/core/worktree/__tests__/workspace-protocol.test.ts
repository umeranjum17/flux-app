import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceEvent,
  parseAllWorkspaceEvents,
  buildWorkspaceProtocolPrompt,
} from '../workspace-protocol';

describe('parseWorkspaceEvent', () => {
  it('parses a working state', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"state":"working"}',
    );
    expect(result).toEqual({ state: 'working' });
  });

  it('parses ready_for_review with workspace_name', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"state":"ready_for_review","workspace_name":"Fix Token Refresh Logic"}',
    );
    expect(result).toEqual({
      state: 'ready_for_review',
      workspace_name: 'Fix Token Refresh Logic',
    });
  });

  it('parses merged state', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"state":"merged"}',
    );
    expect(result).toEqual({ state: 'merged' });
  });

  it('parses idle state', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"state":"idle"}',
    );
    expect(result).toEqual({ state: 'idle' });
  });

  it('accepts canonical FLUX_WORKSPACE_LIFECYCLE prefix', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE_LIFECYCLE: {"state":"working"}',
    );
    expect(result).toEqual({ state: 'working' });
  });

  it('accepts legacy FLUX_WORKSPACE prefix', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE: {"state":"working"}',
    );
    expect(result).toEqual({ state: 'working' });
  });

  it('returns null for non-lifecycle text', () => {
    expect(parseWorkspaceEvent('Hello world')).toBeNull();
    expect(parseWorkspaceEvent('FLUX_LIFECYCLE: not json')).toBeNull();
    expect(parseWorkspaceEvent('')).toBeNull();
  });

  it('returns null for invalid state', () => {
    expect(
      parseWorkspaceEvent('FLUX_LIFECYCLE: {"state":"setup_database"}'),
    ).toBeNull();
  });

  it('returns null for old step_start events (no longer valid)', () => {
    expect(
      parseWorkspaceEvent('FLUX_LIFECYCLE: {"event":"step_start","step":1}'),
    ).toBeNull();
  });

  it('returns null for missing state field', () => {
    expect(
      parseWorkspaceEvent('FLUX_LIFECYCLE: {"workspace_name":"foo"}'),
    ).toBeNull();
  });

  it('extracts first match from multi-line text', () => {
    const text = [
      'Some intro text',
      'FLUX_LIFECYCLE: {"state":"working"}',
      'More text',
      'FLUX_LIFECYCLE: {"state":"ready_for_review"}',
    ].join('\n');

    const result = parseWorkspaceEvent(text);
    expect(result).toEqual({ state: 'working' });
  });

  it('truncates long workspace names to 50 chars', () => {
    const longName = 'B'.repeat(100);
    const result = parseWorkspaceEvent(
      `FLUX_LIFECYCLE: {"state":"ready_for_review","workspace_name":"${longName}"}`,
    );
    expect(result?.workspace_name).toHaveLength(50);
  });

  it('handles extra whitespace after prefix', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE:   {"state":"working"}',
    );
    expect(result).toEqual({ state: 'working' });
  });
});

describe('parseAllWorkspaceEvents', () => {
  it('extracts all lifecycle events from multi-line text', () => {
    const text = [
      'Starting work...',
      'FLUX_LIFECYCLE: {"state":"working"}',
      'Doing stuff...',
      'FLUX_LIFECYCLE: {"state":"ready_for_review","workspace_name":"Add Tests"}',
    ].join('\n');

    const events = parseAllWorkspaceEvents(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ state: 'working' });
    expect(events[1]).toEqual({ state: 'ready_for_review', workspace_name: 'Add Tests' });
  });

  it('handles mixed legacy and new prefixes', () => {
    const text = [
      'FLUX_LIFECYCLE: {"state":"working"}',
      'FLUX_WORKSPACE: {"state":"ready_for_review"}',
    ].join('\n');

    const events = parseAllWorkspaceEvents(text);
    expect(events).toHaveLength(2);
  });

  it('returns empty array for text without lifecycle events', () => {
    expect(parseAllWorkspaceEvents('just some text')).toEqual([]);
  });

  it('skips malformed JSON lines', () => {
    const text = [
      'FLUX_LIFECYCLE: {"state":"working"}',
      'FLUX_LIFECYCLE: {broken json',
      'FLUX_LIFECYCLE: {"state":"ready_for_review"}',
    ].join('\n');

    const events = parseAllWorkspaceEvents(text);
    expect(events).toHaveLength(2);
  });
});

describe('buildWorkspaceProtocolPrompt', () => {
  it('returns instructions with allowed lifecycle states', () => {
    const prompt = buildWorkspaceProtocolPrompt();
    expect(prompt).toContain('FLUX_WORKSPACE_LIFECYCLE');
    expect(prompt).toContain('working');
    expect(prompt).toContain('ready_for_review');
    expect(prompt).toContain('workspace_name');
    // Should NOT contain old step-based concepts
    expect(prompt).not.toContain('step_start');
    expect(prompt).not.toContain('step_done');
  });
});
