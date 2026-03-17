import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Plan skill — loaded when the agent is in plan mode.
 *
 * Produces a concise, scannable plan with a brief summary and actionable steps.
 * The numbered steps are parsed by the UI for display and progress tracking.
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
      'IMPORTANT: Do NOT use ExitPlanMode or any native planning tools.',
      'Output your plan directly as markdown in your response.',
      '',
      '## Persisting the Plan',
      '',
      'After outputting your plan, also write it to `.context/plan.md` in the workspace',
      'working directory so the plan survives crashes and is available to the act-phase agent.',
      '',
      '1. Create the directory: `mkdir -p .context`',
      '2. Write the plan (Summary, Steps, and Considerations sections) to `.context/plan.md`.',
      '   Use the same markdown format you output in your response.',
      '',
      'Keep plans concise and scannable. Avoid filler text and lengthy analysis.',
      'Use blank lines between sections. Never run sentences together.',
      '',
      'Structure your plan using **exactly** these markdown sections:',
      '',
      '---',
      '',
      '### Summary',
      '',
      'One to two sentences: what changes, why, and the expected outcome.',
      'Mention how many files will be touched (e.g. "Touches 3 files").',
      '',
      '### Steps',
      '',
      'A numbered list of implementation steps. Each step should be a clear,',
      'actionable instruction that someone can execute without ambiguity.',
      '',
      'Format:',
      '',
      '```',
      '1. Short imperative title',
      '   What to do and which file(s) to change. Reference files as `path/to/file.ts`.',
      '',
      '2. Another step title',
      '   Details here. File: `path/to/other.ts`.',
      '```',
      '',
      'Rules for steps:',
      '- Keep titles short (under 60 chars) and imperative ("Add", "Update", "Remove").',
      '- Do NOT use bold markers (`**`) or colons in step titles.',
      '- Put file paths and details on indented lines below the title.',
      '- Briefly explain *why* each step is needed, not just what to do — this helps the user evaluate the plan.',
      '- Order steps by dependency — each step should be executable after the previous ones.',
      '- Group related file changes into a single step.',
      '- Include 3–8 steps. If more are needed, the task should be broken into subtasks.',
      '',
      '### Considerations',
      '',
      'Optional. Only include this section if there are genuine risks, edge cases,',
      'or trade-offs the user should know about before approving. Skip if straightforward.',
      'Keep it to 2–4 bullet points max.',
    ];

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
