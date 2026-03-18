import { describe, it, expect } from 'vitest';
import { parseFluxSignal, parseAllFluxSignals } from '../skills/signal-parser';

describe('parseFluxSignal', () => {
  it('parses step_start signal', () => {
    const result = parseFluxSignal('FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Set up DB"}');
    expect(result).toEqual({ type: 'step_start', step: 1, label: 'Set up DB' });
  });

  it('parses step_done signal', () => {
    const result = parseFluxSignal('FLUX_SIGNAL: {"type":"step_done","step":2}');
    expect(result).toEqual({ type: 'step_done', step: 2 });
  });

  it('parses completed signal with workspace_name', () => {
    const result = parseFluxSignal('FLUX_SIGNAL: {"type":"completed","workspace_name":"Fix Login Bug"}');
    expect(result).toEqual({ type: 'completed', workspace_name: 'Fix Login Bug' });
  });

  it('parses todo_update signal with full snapshot', () => {
    const input = 'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Step A","status":"done"},{"label":"Step B","status":"in_progress"},{"label":"Step C","status":"pending"}]}';
    const result = parseFluxSignal(input);
    expect(result).toEqual({
      type: 'todo_update',
      todos: [
        { label: 'Step A', status: 'done' },
        { label: 'Step B', status: 'in_progress' },
        { label: 'Step C', status: 'pending' },
      ],
    });
  });

  it('returns null for non-signal text', () => {
    expect(parseFluxSignal('just some text')).toBeNull();
    expect(parseFluxSignal('FLUX_LIFECYCLE: {"event":"step_start"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseFluxSignal('FLUX_SIGNAL: {not json}')).toBeNull();
  });

  it('returns null for unknown signal type', () => {
    expect(parseFluxSignal('FLUX_SIGNAL: {"type":"unknown_event"}')).toBeNull();
  });

  it('truncates long labels to 50 chars', () => {
    const longLabel = 'A'.repeat(100);
    const result = parseFluxSignal(`FLUX_SIGNAL: {"type":"step_start","step":1,"label":"${longLabel}"}`);
    expect(result?.label).toHaveLength(50);
  });

  it('parses rename signal with workspace_name', () => {
    const result = parseFluxSignal('FLUX_SIGNAL: {"type":"rename","workspace_name":"Fix Token Refresh Logic"}');
    expect(result).toEqual({ type: 'rename', workspace_name: 'Fix Token Refresh Logic' });
  });

  it('normalizes todo status variants', () => {
    const input = 'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"A","status":"completed"},{"label":"B","status":"in-progress"},{"label":"C","status":"active"}]}';
    const result = parseFluxSignal(input);
    expect(result?.todos).toEqual([
      { label: 'A', status: 'done' },
      { label: 'B', status: 'in_progress' },
      { label: 'C', status: 'in_progress' },
    ]);
  });

  it('parses the first signal when multiple appear on one line', () => {
    const input = 'FLUX_SIGNAL: {"type":"step_done","step":1} FLUX_SIGNAL: {"type":"step_start","step":2,"label":"Next"}';
    const result = parseFluxSignal(input);
    expect(result).toEqual({ type: 'step_done', step: 1 });
  });
});

describe('parseAllFluxSignals', () => {
  it('extracts multiple signals from multi-line text', () => {
    const text = [
      'Starting work...',
      'FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Set up schema"}',
      'Created tables.',
      'FLUX_SIGNAL: {"type":"step_done","step":1}',
      'FLUX_SIGNAL: {"type":"step_start","step":2,"label":"Add endpoints"}',
    ].join('\n');

    const results = parseAllFluxSignals(text);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ type: 'step_start', step: 1, label: 'Set up schema' });
    expect(results[1]).toEqual({ type: 'step_done', step: 1 });
    expect(results[2]).toEqual({ type: 'step_start', step: 2, label: 'Add endpoints' });
  });

  it('returns empty array for text with no signals', () => {
    expect(parseAllFluxSignals('no signals here')).toEqual([]);
  });

  it('skips invalid lines and continues parsing', () => {
    const text = [
      'FLUX_SIGNAL: {bad json}',
      'FLUX_SIGNAL: {"type":"step_done","step":1}',
    ].join('\n');

    const results = parseAllFluxSignals(text);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('step_done');
  });

  it('extracts multiple signals emitted on a single line', () => {
    const text = 'FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Plan"} FLUX_SIGNAL: {"type":"step_done","step":1}';
    const results = parseAllFluxSignals(text);
    expect(results).toEqual([
      { type: 'step_start', step: 1, label: 'Plan' },
      { type: 'step_done', step: 1 },
    ]);
  });
});
