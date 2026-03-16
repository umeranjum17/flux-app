import { describe, expect, it } from 'vitest';
import { parseStepMarkers, getStepTrackableContent, extractTodoItemsFromPayload, isTodoTrackingToolCall, parseTodoBlock, parseFluxTodo, parseFluxTodoAll, parseAgentTodos } from '../utils';
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

  it('extracts label from START marker with colon', () => {
    expect(parseStepMarkers('[STEP 1 START: Set up database schema]')).toEqual([
      { stepId: 1, status: 'in_progress', label: 'Set up database schema' },
    ]);
  });

  it('preserves label when DONE wins over START', () => {
    const markers = parseStepMarkers('[STEP 2 START: Add API endpoints] work [STEP 2 DONE]');
    expect(markers).toEqual([{ stepId: 2, status: 'done', label: 'Add API endpoints' }]);
  });

  it('handles START without label (undefined)', () => {
    const markers = parseStepMarkers('[STEP 3 START]');
    expect(markers[0].label).toBeUndefined();
  });

  it('handles mixed labeled and unlabeled markers', () => {
    const markers = parseStepMarkers(
      '[STEP 1 START: Fix auth] done [STEP 1 DONE] [STEP 2 START]',
    );
    expect(markers).toHaveLength(2);
    expect(markers).toContainEqual({ stepId: 1, status: 'done', label: 'Fix auth' });
    expect(markers).toContainEqual({ stepId: 2, status: 'in_progress', label: undefined });
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

describe('extractTodoItemsFromPayload', () => {
  it('normalizes update_plan payloads into todo items', () => {
    expect(extractTodoItemsFromPayload({
      plan: [
        { step: 'Inspect Codex event payloads', status: 'completed' },
        { step: 'Sync renderer todo bar', status: 'in_progress' },
      ],
    })).toEqual([
      { id: 1, label: 'Inspect Codex event payloads', status: 'done' },
      { id: 2, label: 'Sync renderer todo bar', status: 'in_progress' },
    ]);
  });
});

describe('isTodoTrackingToolCall', () => {
  it('recognizes update_plan tool calls with plan items', () => {
    expect(isTodoTrackingToolCall('update_plan', {
      plan: [{ step: 'Ship the fix', status: 'pending' }],
    })).toBe(true);
  });
});

describe('parseFluxTodo', () => {
  it('parses FLUX_TODO: JSON lines', () => {
    const items = parseFluxTodo('FLUX_TODO:{"todos":[{"label":"Step one","status":"done"}]}');
    expect(items).toEqual([{ id: 1, label: 'Step one', status: 'done' }]);
  });

  it('still parses legacy FLUX_PROGRESS: JSON lines', () => {
    const items = parseFluxTodo('FLUX_PROGRESS:{"todos":[{"label":"Legacy step","status":"pending"}]}');
    expect(items).toEqual([{ id: 1, label: 'Legacy step', status: 'pending' }]);
  });

  it('returns null for unrelated content', () => {
    expect(parseFluxTodo('just some text')).toBeNull();
  });
});

describe('parseFluxTodoAll', () => {
  it('returns items from the last FLUX_TODO line', () => {
    const content = [
      'FLUX_TODO:{"todos":[{"label":"A","status":"done"}]}',
      'some other text',
      'FLUX_TODO:{"todos":[{"label":"A","status":"done"},{"label":"B","status":"in_progress"}]}',
    ].join('\n');
    const items = parseFluxTodoAll(content);
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ id: 2, label: 'B', status: 'in_progress' });
  });

  it('handles mixed FLUX_TODO and legacy FLUX_PROGRESS lines', () => {
    const content = [
      'FLUX_PROGRESS:{"todos":[{"label":"Old","status":"done"}]}',
      'FLUX_TODO:{"todos":[{"label":"New","status":"in_progress"}]}',
    ].join('\n');
    const items = parseFluxTodoAll(content);
    expect(items).toEqual([{ id: 1, label: 'New', status: 'in_progress' }]);
  });
});

describe('parseTodoBlock', () => {
  it('parses ```todo fenced blocks', () => {
    const content = '```todo\n- [x] First step\n- [ ] Second step\n```';
    const items = parseTodoBlock(content);
    expect(items).toEqual([
      { id: 1, label: 'First step', status: 'done' },
      { id: 2, label: 'Second step', status: 'pending' },
    ]);
  });

  it('still parses legacy ```progress fenced blocks', () => {
    const content = '```progress\n- [x] Done step\n- [>] Active step\n```';
    const items = parseTodoBlock(content);
    expect(items).toEqual([
      { id: 1, label: 'Done step', status: 'done' },
      { id: 2, label: 'Active step', status: 'in_progress' },
    ]);
  });

  it('returns empty for no blocks', () => {
    expect(parseTodoBlock('no blocks here')).toEqual([]);
  });
});

describe('parseAgentTodos', () => {
  it('returns flux_todo source for FLUX_TODO lines', () => {
    const result = parseAgentTodos('FLUX_TODO:{"todos":[{"label":"Step","status":"pending"}]}');
    expect(result.source).toBe('flux_todo');
    expect(result.items).toHaveLength(1);
  });

  it('returns todo_block source for fenced todo blocks', () => {
    const result = parseAgentTodos('```todo\n- [ ] A task\n- [ ] Another\n```');
    expect(result.source).toBe('todo_block');
    expect(result.items).toHaveLength(2);
  });

  it('returns flux_todo source for legacy FLUX_PROGRESS lines', () => {
    const result = parseAgentTodos('FLUX_PROGRESS:{"todos":[{"label":"Old","status":"done"}]}');
    expect(result.source).toBe('flux_todo');
    expect(result.items).toHaveLength(1);
  });

  it('returns none when no patterns match', () => {
    const result = parseAgentTodos('just regular text');
    expect(result.source).toBe('none');
    expect(result.items).toEqual([]);
  });
});
