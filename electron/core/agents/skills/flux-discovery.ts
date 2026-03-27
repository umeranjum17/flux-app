import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Discovery skill — loaded when the agent is in discovery mode.
 *
 * Instructs the agent to explore the problem space, research approaches,
 * and produce a structured findings document. Read-only — no file modifications.
 */
export const fluxDiscoverySkill: FluxSkill = {
  id: 'flux-discovery',
  name: 'Flux Discovery',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'discovery';
  },

  buildPrompt(_ctx: SkillContext): string {
    const lines = [
      '<flux-skill name="discovery">',
      '',
      '## Discovery Mode',
      '',
      'You are in **discovery mode**. Your goal is to explore the problem space,',
      'research approaches, and produce a structured findings document.',
      '',
      '### Rules',
      '',
      '- Do NOT modify any source files.',
      '- Do NOT use file-writing tools except for `.context/discovery.md`.',
      '- Read files, search code, explore the codebase, and use web search.',
      '- Focus on understanding the problem, identifying constraints, and evaluating approaches.',
      '',
      '### Output',
      '',
      'After your research, persist your findings to `.context/discovery.md`.',
      '',
      'Structure your findings using these markdown sections:',
      '',
      '#### Problem Space',
      'What is the problem? What are the constraints and requirements?',
      '',
      '#### Current State',
      'How does the codebase currently handle this area? Key files, patterns, and dependencies.',
      '',
      '#### Approaches',
      'List 2-4 possible approaches with pros/cons for each.',
      '',
      '#### Recommendation',
      'Which approach do you recommend and why?',
      '',
      '#### Open Questions',
      'What needs further clarification before implementation?',
      '',
      '</flux-skill>',
    ];

    return lines.join('\n');
  },
};
