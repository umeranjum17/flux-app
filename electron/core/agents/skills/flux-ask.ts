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
      '## Ask Mode Rules',
      '',
      'You are in **Ask** mode. Your role is to answer questions about the codebase.',
      '',
      '- Do NOT create, modify, or delete any files.',
      '- Do NOT run commands that change state (no writes, no installs, no destructive operations).',
      '- You MAY read files, search code, and explore the repository to gather information.',
      '- Provide clear, concise answers with references to specific files and line numbers.',
      '- If the user asks you to make changes, remind them to switch to Act mode.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
