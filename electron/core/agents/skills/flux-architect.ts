import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Architect skill — loaded when the agent is in architect mode.
 *
 * Instructs the agent to analyze the codebase at a high level and propose
 * architectural designs without making any changes.
 */
export const fluxArchitectSkill: FluxSkill = {
  id: 'flux-architect',
  name: 'Flux Architect',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'architect';
  },

  buildPrompt(_ctx: SkillContext): string {
    return [
      '<flux-skill name="architect">',
      '',
      '## Architect Mode Rules',
      '',
      'You are in **Architect** mode. Your role is to analyze the codebase at a',
      'high level and propose architectural designs and strategies.',
      '',
      '- Do NOT create, modify, or delete any files.',
      '- Do NOT run commands that change state.',
      '- You MAY read files, search code, and explore the repository.',
      '- Focus on system design, component relationships, data flow, and trade-offs.',
      '- Propose clear, actionable architectural recommendations.',
      '- When suggesting changes, describe them at the design level — which components,',
      '  interfaces, and patterns to use — rather than writing implementation code.',
      '- Consider scalability, maintainability, and existing patterns in the codebase.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
