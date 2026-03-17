import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Plan skill — loaded when the agent is in plan mode.
 *
 * Provides structured plan format instructions that produce parseable output.
 * The plan's numbered steps are extracted by the UI for progress tracking
 * when the user switches to act mode.
 *
 * Output: Structured markdown with Summary / Analysis / Steps / Verification sections.
 */
export const fluxPlanSkill: FluxSkill = {
  id: 'flux-plan',
  name: 'Flux Plan',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'plan';
  },

  buildPrompt(ctx: SkillContext): string {
    const lines = [
      '<flux-skill name="plan">',
      '',
      '## Plan Output Rules',
      '',
      'IMPORTANT: Do NOT write plan files to disk. Do NOT use ExitPlanMode or any',
      'native planning tools. Output your plan directly as markdown in your response.',
      '',
      'Your output must be well-formatted markdown with proper spacing.',
      'Use blank lines between sections and paragraphs. Never run words or sentences together.',
      '',
      'Structure your plan using **exactly** these markdown sections in this order:',
      '',
      '---',
      '',
      '### Summary',
      '',
      'Write 1-2 complete sentences explaining: what changes, why, and the expected outcome.',
      '',
      '### Analysis',
      '',
      'Thorough examination of the current state. For each area you analyze:',
      '',
      '- Reference specific files and line numbers as `path/to/file.ts:42`.',
      '- Identify risks, constraints, and dependencies.',
      '- Note any existing tests, type coverage, or validation that the change touches.',
      '- Call out security considerations if the change involves auth, user input, or external data.',
      '',
      '### Steps',
      '',
      'Write a numbered list of implementation steps.',
      'The Flux UI parses this numbered list to track progress, so follow this format exactly:',
      '',
      '```',
      '1. Short action-oriented title (under 60 chars)',
      '   Details about what to do. File: `path/to/file.ts`.',
      '',
      '2. Another short title',
      '   More details here.',
      '',
      '3. Yet another step',
      '   Details for this step.',
      '```',
      '',
      'Rules for steps:',
      '- Each step title must be on the numbered line itself, short and imperative.',
      '- Do NOT use bold markers or colons in step titles.',
      '- Put details on indented lines below the title.',
      '- Separate steps with a blank line.',
      '- Order steps by dependency so they can be executed sequentially.',
      '- Group related file changes under the same step.',
      '',
      '### Verification',
      '',
      'How to confirm the implementation is correct:',
      '',
      '- **Type safety:** Commands to run (`npm run typecheck`, `tsc --noEmit`, etc.).',
      '- **Tests:** Which test suites to run and what new tests to add.',
      '- **Lint/format:** Any lint or format checks (`npm run lint`, `eslint`, etc.).',
      '- **Manual testing:** Step-by-step instructions to manually verify the behavior.',
      '- **Edge cases:** Boundary conditions, error paths, and regression risks.',
    ];

    // Additional sections for more capable agents
    if (ctx.agentId === 'claude-code') {
      lines.push(
        '',
        '### Rollback',
        '',
        'If the change needs to be reverted:',
        '- Which commits to revert or files to restore.',
        '- Any database migrations or external state that would need cleanup.',
      );
    }

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
