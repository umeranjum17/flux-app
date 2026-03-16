import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceEvent,
  parseAllWorkspaceEvents,
  buildWorkspacePrompt,
} from '../workspace-protocol';

describe('parseWorkspaceEvent', () => {
  it('parses a working state', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE: {"state":"working"}',
    );
    expect(result).toEqual({ state: 'working' });
  });

  it('parses a ready_for_review state', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE: {"state":"ready_for_review"}',
    );
    expect(result).toEqual({ state: 'ready_for_review' });
  });

  it('parses a completed state with workspace_name', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE: {"state":"completed","workspace_name":"Fix Token Refresh Logic"}',
    );
    expect(result).toEqual({
      state: 'completed',
      workspace_name: 'Fix Token Refresh Logic',
    });
  });

  it('returns null for non-workspace text', () => {
    expect(parseWorkspaceEvent('Hello world')).toBeNull();
    expect(parseWorkspaceEvent('FLUX_WORKSPACE: not json')).toBeNull();
    expect(parseWorkspaceEvent('')).toBeNull();
  });

  it('returns null for invalid state', () => {
    expect(
      parseWorkspaceEvent('FLUX_WORKSPACE: {"state":"invalid_state"}'),
    ).toBeNull();
  });

  it('returns null for missing state field', () => {
    expect(
      parseWorkspaceEvent('FLUX_WORKSPACE: {"workspace_name":"foo"}'),
    ).toBeNull();
  });

  it('parses legacy FLUX_LIFECYCLE completed event', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"event":"completed","workspace_name":"Fix Token Refresh"}',
    );
    expect(result).toEqual({ state: 'completed', workspace_name: 'Fix Token Refresh' });
  });

  it('maps legacy FLUX_LIFECYCLE step_start to working', () => {
    const result = parseWorkspaceEvent(
      'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Setup"}',
    );
    expect(result).toEqual({ state: 'working' });
  });

  it('rejects legacy FLUX_LIFECYCLE with unknown event', () => {
    expect(
      parseWorkspaceEvent('FLUX_LIFECYCLE: {"event":"unknown_thing"}'),
    ).toBeNull();
  });

  it('extracts first match from multi-line text', () => {
    const text = [
      'Some intro text',
      'FLUX_WORKSPACE: {"state":"working"}',
      'More text',
      'FLUX_WORKSPACE: {"state":"ready_for_review"}',
    ].join('\n');

    const result = parseWorkspaceEvent(text);
    expect(result).toEqual({ state: 'working' });
  });

  it('truncates long workspace names to 50 chars', () => {
    const longName = 'B'.repeat(100);
    const result = parseWorkspaceEvent(
      `FLUX_WORKSPACE: {"state":"completed","workspace_name":"${longName}"}`,
    );
    expect(result?.workspace_name).toHaveLength(50);
  });

  it('handles extra whitespace after prefix', () => {
    const result = parseWorkspaceEvent(
      'FLUX_WORKSPACE:   {"state":"ready_for_review"}',
    );
    expect(result).toEqual({ state: 'ready_for_review' });
  });
});

describe('parseAllWorkspaceEvents', () => {
  it('extracts all workspace events from multi-line text', () => {
    const text = [
      'Starting work...',
      'FLUX_WORKSPACE: {"state":"working"}',
      'Doing stuff...',
      'FLUX_WORKSPACE: {"state":"ready_for_review"}',
      'FLUX_WORKSPACE: {"state":"completed","workspace_name":"Add Tests"}',
    ].join('\n');

    const events = parseAllWorkspaceEvents(text);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ state: 'working' });
    expect(events[1]).toEqual({ state: 'ready_for_review' });
    expect(events[2]).toEqual({ state: 'completed', workspace_name: 'Add Tests' });
  });

  it('returns empty array for text without workspace events', () => {
    expect(parseAllWorkspaceEvents('just some text')).toEqual([]);
  });

  it('skips malformed JSON lines', () => {
    const text = [
      'FLUX_WORKSPACE: {"state":"working"}',
      'FLUX_WORKSPACE: {broken json',
      'FLUX_WORKSPACE: {"state":"completed","workspace_name":"Done"}',
    ].join('\n');

    const events = parseAllWorkspaceEvents(text);
    expect(events).toHaveLength(2);
  });
});

describe('buildWorkspacePrompt', () => {
  it('returns instructions with FLUX_WORKSPACE protocol', () => {
    const prompt = buildWorkspacePrompt();
    expect(prompt).toContain('FLUX_WORKSPACE');
    expect(prompt).toContain('working');
    expect(prompt).toContain('ready_for_review');
    expect(prompt).toContain('completed');
    expect(prompt).toContain('workspace_name');
  });

  it('does not reference old FLUX_LIFECYCLE protocol', () => {
    const prompt = buildWorkspacePrompt();
    expect(prompt).not.toContain('FLUX_LIFECYCLE');
    expect(prompt).not.toContain('step_start');
    expect(prompt).not.toContain('step_done');
  });
});
