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
      '## Plan Output Format',
      '',
      'Structure your plan using **exactly** these markdown sections.',
      'The Flux UI parses this structure to extract steps for progress tracking.',
      '',
      '---',
      '',
      '### Summary',
      'One or two sentences: **what** changes, **why**, and the **expected outcome**.',
      '',
      '### Analysis',
      'Your findings from reading the code. Reference specific files as `path/to/file.ts:42`.',
      'Include risks, constraints, and dependencies.',
      '',
      '### Steps',
      'A numbered list of implementation steps. Each step **MUST** start with a short',
      'action-oriented title (under 60 chars), then details on the next line.',
      '',
      '**Correct format** (the UI parses these numbered lines):',
      '```',
      '1. Add email validation to login form',
      '   Check format and length before submission. File: `src/auth/LoginForm.tsx`.',
      '',
      '2. Create inline error display component',
      '   Show errors below each field using the existing Alert component.',
      '',
      '3. Add unit tests for validation logic',
      '   Cover empty input, invalid format, and boundary cases.',
      '```',
      '',
      '**Bad** — do not use bold markers, colons, or full sentences as titles:',
      '```',
      '1. **Authentication bug**: The login handler at line 45 fails when...',
      '```',
      '',
      '**Good** — short, imperative, scannable:',
      '```',
      '1. Fix login handler validation',
      '```',
    ];

    // Agent-specific guidance for plan quality
    if (ctx.agentId === 'claude-code') {
      lines.push(
        '',
        '### Verification',
        'How to validate the implementation:',
        '- Commands to run (`npm test`, `npm run typecheck`, etc.)',
        '- Manual testing steps and expected behavior',
        '- Edge cases to watch for',
      );
    }

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
