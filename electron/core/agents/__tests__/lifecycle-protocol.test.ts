import { describe, expect, it } from 'vitest';
import {
  parseLifecycleEvent,
  parseAllLifecycleEvents,
  buildLifecyclePrompt,
} from '../lifecycle-protocol';

describe('parseLifecycleEvent', () => {
  it('parses a step_start event', () => {
    const result = parseLifecycleEvent(
      'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Set up database schema"}',
    );
    expect(result).toEqual({
      event: 'step_start',
      step: 1,
      label: 'Set up database schema',
    });
  });

  it('parses a step_done event', () => {
    const result = parseLifecycleEvent(
      'FLUX_LIFECYCLE: {"event":"step_done","step":2}',
    );
    expect(result).toEqual({ event: 'step_done', step: 2 });
  });

  it('parses a completed event with workspace_name', () => {
    const result = parseLifecycleEvent(
      'FLUX_LIFECYCLE: {"event":"completed","workspace_name":"Fix Token Refresh Logic"}',
    );
    expect(result).toEqual({
      event: 'completed',
      workspace_name: 'Fix Token Refresh Logic',
    });
  });

  it('returns null for non-lifecycle text', () => {
    expect(parseLifecycleEvent('Hello world')).toBeNull();
    expect(parseLifecycleEvent('FLUX_LIFECYCLE: not json')).toBeNull();
    expect(parseLifecycleEvent('')).toBeNull();
  });

  it('returns null for invalid event type', () => {
    expect(
      parseLifecycleEvent('FLUX_LIFECYCLE: {"event":"invalid_event"}'),
    ).toBeNull();
  });

  it('returns null for missing event field', () => {
    expect(
      parseLifecycleEvent('FLUX_LIFECYCLE: {"step":1,"label":"foo"}'),
    ).toBeNull();
  });

  it('extracts first match from multi-line text', () => {
    const text = [
      'Some intro text',
      'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"First"}',
      'More text',
      'FLUX_LIFECYCLE: {"event":"step_done","step":1}',
    ].join('\n');

    const result = parseLifecycleEvent(text);
    expect(result).toEqual({ event: 'step_start', step: 1, label: 'First' });
  });

  it('truncates long labels to 50 chars', () => {
    const longLabel = 'A'.repeat(100);
    const result = parseLifecycleEvent(
      `FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"${longLabel}"}`,
    );
    expect(result?.label).toHaveLength(50);
  });

  it('truncates long workspace names to 50 chars', () => {
    const longName = 'B'.repeat(100);
    const result = parseLifecycleEvent(
      `FLUX_LIFECYCLE: {"event":"completed","workspace_name":"${longName}"}`,
    );
    expect(result?.workspace_name).toHaveLength(50);
  });

  it('handles extra whitespace after prefix', () => {
    const result = parseLifecycleEvent(
      'FLUX_LIFECYCLE:   {"event":"step_done","step":3}',
    );
    expect(result).toEqual({ event: 'step_done', step: 3 });
  });

  it('ignores non-number step values', () => {
    const result = parseLifecycleEvent(
      'FLUX_LIFECYCLE: {"event":"step_start","step":"one","label":"foo"}',
    );
    expect(result).toEqual({ event: 'step_start', label: 'foo' });
  });
});

describe('parseAllLifecycleEvents', () => {
  it('extracts all lifecycle events from multi-line text', () => {
    const text = [
      'Starting work...',
      'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Setup"}',
      'Doing stuff...',
      'FLUX_LIFECYCLE: {"event":"step_done","step":1}',
      'FLUX_LIFECYCLE: {"event":"step_start","step":2,"label":"Tests"}',
      'FLUX_LIFECYCLE: {"event":"step_done","step":2}',
      'FLUX_LIFECYCLE: {"event":"completed","workspace_name":"Add Tests"}',
    ].join('\n');

    const events = parseAllLifecycleEvents(text);
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual({ event: 'step_start', step: 1, label: 'Setup' });
    expect(events[1]).toEqual({ event: 'step_done', step: 1 });
    expect(events[2]).toEqual({ event: 'step_start', step: 2, label: 'Tests' });
    expect(events[3]).toEqual({ event: 'step_done', step: 2 });
    expect(events[4]).toEqual({ event: 'completed', workspace_name: 'Add Tests' });
  });

  it('returns empty array for text without lifecycle events', () => {
    expect(parseAllLifecycleEvents('just some text')).toEqual([]);
  });

  it('skips malformed JSON lines', () => {
    const text = [
      'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Good"}',
      'FLUX_LIFECYCLE: {broken json',
      'FLUX_LIFECYCLE: {"event":"step_done","step":1}',
    ].join('\n');

    const events = parseAllLifecycleEvents(text);
    expect(events).toHaveLength(2);
  });
});

describe('buildLifecyclePrompt', () => {
  it('returns a non-empty string with lifecycle instructions', () => {
    const prompt = buildLifecyclePrompt();
    expect(prompt).toContain('FLUX_LIFECYCLE');
    expect(prompt).toContain('step_start');
    expect(prompt).toContain('step_done');
    expect(prompt).toContain('completed');
    expect(prompt).toContain('workspace_name');
  });
});
