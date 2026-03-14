import { describe, expect, it } from 'vitest';
import { getLatestPlanText, isLikelyPlanText } from '../plan';
import type { AgentMessage } from '../types';

describe('plan helpers', () => {
  it('rejects exploratory commentary', () => {
    expect(isLikelyPlanText(
      "I'll inspect the project structure and current breakpoints so I can map fixes to exact files.",
    )).toBe(false);
  });

  it('accepts structured markdown plans', () => {
    expect(isLikelyPlanText(`## Summary
Ship the renderer fix without changing the agent protocol.

## Analysis
The UI is treating all plan-mode assistant text as final plan content.

## Steps
1. Add a helper that identifies structured plan markdown.
2. Only render the final structured response in the plan card.
3. Leave exploratory updates as normal assistant messages.

## Trade-offs
This relies on structure, but the plan prompt already requires it.`)).toBe(true);
  });

  it('returns the latest structured plan text only', () => {
    const messages: AgentMessage[] = [
      {
        type: 'text',
        role: 'assistant',
        content: "I'll inspect the task flow first.",
        timestamp: 1,
      },
      {
        type: 'text',
        role: 'assistant',
        content: `## Summary
Fix plan rendering.

## Analysis
Only structured plan markdown should feed the plan UI.

## Steps
1. Detect structured plan text.
2. Filter interim commentary out of the plan card.
3. Keep progress messages visible as normal chat.

## Trade-offs
Unstructured plans will not render as plan cards.`,
        timestamp: 2,
      },
    ];

    expect(getLatestPlanText(messages)).toContain('Fix plan rendering.');
    expect(getLatestPlanText(messages)).not.toContain("I'll inspect the task flow first.");
  });
});
