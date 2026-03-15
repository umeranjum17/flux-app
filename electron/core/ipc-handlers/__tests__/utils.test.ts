import { describe, expect, it } from 'vitest';
import { parseStepMarkers, getStepTrackableContent } from '../utils';
import type { AgentMessage } from '../../agents/types';

describe('parseStepMarkers', () => {
  it('extracts START markers', () => {
    expect(parseStepMarkers('[STEP 1 START]')).toEqual([
      { stepId: 1, status: 'in_progress' },
    ]);
  });

  it('extracts DONE markers', () => {
    expect(parseStepMarkers('[STEP 3 DONE]')).toEqual([
      { stepId: 3, status: 'done' },
    ]);
  });

  it('handles both START and DONE for the same step — DONE wins', () => {
    const markers = parseStepMarkers('[STEP 2 START] some work [STEP 2 DONE]');
    expect(markers).toEqual([{ stepId: 2, status: 'done' }]);
  });

  it('extracts multiple different steps', () => {
    const markers = parseStepMarkers(
      'Starting [STEP 1 DONE] now [STEP 2 START] and [STEP 3 START]',
    );
    expect(markers).toHaveLength(3);
    expect(markers).toContainEqual({ stepId: 1, status: 'done' });
    expect(markers).toContainEqual({ stepId: 2, status: 'in_progress' });
    expect(markers).toContainEqual({ stepId: 3, status: 'in_progress' });
  });

  it('is case-insensitive', () => {
    expect(parseStepMarkers('[step 1 done]')).toEqual([
      { stepId: 1, status: 'done' },
    ]);
    expect(parseStepMarkers('[Step 2 Start]')).toEqual([
      { stepId: 2, status: 'in_progress' },
    ]);
  });

  it('handles extra whitespace in markers', () => {
    expect(parseStepMarkers('[STEP  5  DONE]')).toEqual([
      { stepId: 5, status: 'done' },
    ]);
  });

  it('returns empty for no markers', () => {
    expect(parseStepMarkers('just some regular text')).toEqual([]);
    expect(parseStepMarkers('')).toEqual([]);
  });
});

describe('getStepTrackableContent', () => {
  it('returns content for assistant text messages', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'assistant',
      content: 'hello [STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBe('hello [STEP 1 START]');
  });

  it('returns content for status messages', () => {
    const msg: AgentMessage = {
      type: 'status',
      role: 'system',
      content: 'Checking workspace [STEP 1 DONE]',
      timestamp: Date.now(),
      statusKind: 'progress',
    };
    expect(getStepTrackableContent(msg)).toBe('Checking workspace [STEP 1 DONE]');
  });

  it('returns content for tool_result messages', () => {
    const msg: AgentMessage = {
      type: 'tool_result',
      role: 'tool',
      content: 'Output [STEP 2 DONE]',
      timestamp: Date.now(),
      toolCallId: 'tc-1',
    };
    expect(getStepTrackableContent(msg)).toBe('Output [STEP 2 DONE]');
  });

  it('returns null for user messages', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'user',
      content: '[STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });

  it('returns null for thinking messages', () => {
    const msg: AgentMessage = {
      type: 'thinking',
      role: 'assistant',
      content: '[STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });

  it('returns null for empty content', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });
});
