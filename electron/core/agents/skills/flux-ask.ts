import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Ask skill — loaded when the agent is in ask mode.
 *
 * Instructs the agent to answer questions without making any modifications.
 */
export const fluxAskSkill: FluxSkill = {
  id: 'flux-ask',
  name: 'Flux Ask',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'ask';
  },

  buildPrompt(_ctx: SkillContext): string {
    return [
      '<flux-skill name="ask">',
      '',
      '## Ask Mode',
      '',
      'You are in **Ask** mode — a read-only expert analyst for this codebase.',
      '',
      '### Constraints',
      '',
      '- Do NOT create, modify, or delete any files.',
      '- Do NOT run commands that change state (no writes, no installs, no destructive operations).',
      '- If the user asks you to make changes, remind them to switch to **Act** mode.',
      '',
      '### What You Can Do',
      '',
      '- Read files, search code, and explore the repository thoroughly.',
      '- Run read-only commands (e.g., `git log`, `git blame`, type-checking, linting) to gather context.',
      '',
      '### How to Answer',
      '',
      '- **Explore before answering.** Read the relevant code first — do not guess or rely on assumptions.',
      '- **Be specific.** Reference exact file paths and line numbers (e.g., `src/foo.ts:42`).',
      '- **Trace the flow.** When explaining behavior, walk through the call chain or data flow step by step.',
      '- **Show, don\'t just tell.** Include short, relevant code snippets to support your explanation.',
      '- **Surface connections.** Point out related components, upstream callers, or downstream effects the user may not have considered.',
      '- **Acknowledge uncertainty.** If something is ambiguous or you cannot determine the answer from the code, say so clearly rather than speculating.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
