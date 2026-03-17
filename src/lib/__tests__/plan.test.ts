import { describe, expect, it } from 'vitest';
import { getLatestPlanText, isLikelyPlanText, stripFluxTokens } from '../plan';
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

  it('strips FLUX tokens from plan text returned by getLatestPlanText', () => {
    const messages: AgentMessage[] = [
      {
        type: 'text',
        role: 'assistant',
        content: `## Summary
Create a Snake Game with HTML5 Canvas.

## Analysis
page scroll, and both dark/light themes remain visually coherent.

FLUX_WORKSPACE_LIFECYCLE: {"state":"planned"} FLUX_SIGNAL: {"type":"completed","workspace_name":"Plan: Create Snake Game"}

## Steps
1. Create index.html with canvas element.
2. Implement game loop and rendering.
3. Add keyboard controls.

## Trade-offs
Simple implementation without mobile support.`,
        timestamp: 1,
      },
    ];

    const result = getLatestPlanText(messages);
    expect(result).not.toContain('FLUX_WORKSPACE_LIFECYCLE');
    expect(result).not.toContain('FLUX_SIGNAL');
    expect(result).not.toContain('"state":"planned"');
    expect(result).not.toContain('"type":"completed"');
    expect(result).toContain('Create a Snake Game');
    expect(result).toContain('visually coherent');
  });

  describe('stripFluxTokens', () => {
    it('strips both FLUX_WORKSPACE_LIFECYCLE and FLUX_SIGNAL on the same line', () => {
      const input = 'FLUX_WORKSPACE_LIFECYCLE: {"state":"planned"} FLUX_SIGNAL: {"type":"completed","workspace_name":"Plan: Create Snake Game"}';
      const result = stripFluxTokens(input);
      expect(result).not.toContain('FLUX_WORKSPACE_LIFECYCLE');
      expect(result).not.toContain('FLUX_SIGNAL');
      expect(result.trim()).toBe('');
    });

    it('strips tokens embedded in surrounding text', () => {
      const input = 'Some text before.\n\nFLUX_WORKSPACE_LIFECYCLE: {"state":"planned"} FLUX_SIGNAL: {"type":"completed","workspace_name":"Plan: Create Snake Game"}\n\nSome text after.';
      const result = stripFluxTokens(input);
      expect(result).not.toContain('FLUX_WORKSPACE_LIFECYCLE');
      expect(result).not.toContain('FLUX_SIGNAL');
      expect(result).toContain('Some text before.');
      expect(result).toContain('Some text after.');
    });

    it('preserves leading and trailing whitespace', () => {
      expect(stripFluxTokens('\n\nHello world\n\n')).toBe('\n\nHello world\n\n');
    });

    it('returns text unchanged when no tokens present', () => {
      expect(stripFluxTokens('Hello world')).toBe('Hello world');
    });

    it('strips legacy FLUX_WORKSPACE and FLUX_LIFECYCLE prefixes', () => {
      expect(stripFluxTokens('FLUX_WORKSPACE: {"state":"working"}').trim()).toBe('');
      expect(stripFluxTokens('FLUX_LIFECYCLE: {"state":"merged"}').trim()).toBe('');
    });

    it('strips nested FLUX_SIGNAL payloads without touching nearby text', () => {
      const input = [
        'Before text.',
        'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Investigate Copilot text trimming","status":"in_progress"},{"label":"Implement and verify fix","status":"pending"}]}',
        'After text.',
      ].join('\n');

      const result = stripFluxTokens(input);

      expect(result).toContain('Before text.');
      expect(result).toContain('After text.');
      expect(result).not.toContain('Investigate Copilot text trimming');
      expect(result).not.toContain('FLUX_SIGNAL');
    });

    it('strips orphaned JSON closers left by streamed FLUX signals', () => {
      const input = 'Before text.\nFLUX_SIGNAL: {"type":"step_done","step":1\n}\nAfter text.';
      const result = stripFluxTokens(input);

      expect(result).toContain('Before text.');
      expect(result).toContain('After text.');
      expect(result).not.toContain('FLUX_SIGNAL');
      expect(result).not.toContain('\n}\n');
    });
  });
});
