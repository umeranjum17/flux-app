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

  it('accepts plans with a verification section', () => {
    expect(isLikelyPlanText(`## Summary
Migrate the auth module to JWT tokens.

## Analysis
The current session-cookie approach doesn't meet compliance requirements.

## Steps
1. Replace session middleware with JWT verification.
2. Update login endpoint to issue signed tokens.

## Verification
- Run \`npm test\` — all auth tests should pass.
- Manual: verify token refresh works in the browser.

## Trade-offs
JWT adds token-size overhead but eliminates server-side session state.`)).toBe(true);
  });

  it('accepts rich plans with mermaid diagrams and tables', () => {
    expect(isLikelyPlanText(`## Summary
Redesign the data pipeline for real-time ingestion.

\`\`\`mermaid
graph TD
  A[Kafka] --> B[Transform Service]
  B --> C[PostgreSQL]
\`\`\`

## Analysis

| Approach | Latency | Complexity |
|----------|---------|------------|
| Batch    | High    | Low        |
| Stream   | Low     | Medium     |

## Steps
1. Set up Kafka topic for ingest events.
2. Build transform microservice with schema validation.
3. Write integration tests against test cluster.

## Trade-offs
Streaming adds operational complexity but meets the <1s latency target.`)).toBe(true);
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
