import { describe, expect, it } from 'vitest';
import { hasContextStatePayload, parseContextState } from '../protocol';

describe('parseContextState', () => {
  it('normalizes todo statuses and preserves empty todo snapshots', () => {
    const state = parseContextState({
      todos: [
        { label: 'First', status: 'completed' },
        { label: 'Second', status: 'active' },
      ],
    });

    expect(state).toEqual({
      todos: [
        { label: 'First', status: 'done' },
        { label: 'Second', status: 'in_progress' },
      ],
    });

    expect(hasContextStatePayload(parseContextState({ todos: [] })!)).toBe(true);
  });

  it('treats empty objects as non-meaningful state', () => {
    const state = parseContextState({});

    expect(state).toEqual({});
    expect(hasContextStatePayload(state!)).toBe(false);
  });
});
