import type { FluxSkill, SkillContext } from './types';

function basename(value: string): string {
  return value.split('/').pop() || value.split('\\').pop() || value;
}

export const fluxMultiWorkspaceSkill: FluxSkill = {
  id: 'flux-multi-workspace',
  name: 'Flux Multi Workspace',

  isRelevant(ctx: SkillContext): boolean {
    return !!ctx.siblingWorkspaces?.length;
  },

  buildPrompt(ctx: SkillContext): string {
    const siblings = ctx.siblingWorkspaces ?? [];
    const modeRules =
      ctx.mode === 'plan'
        ? [
            'In plan mode, read the primary repo and any sibling repos needed for the feature before producing the plan.',
            'Call out cross-repo dependencies explicitly so the implementation phase can execute them in order.',
          ]
        : [
            'In implementation modes, use absolute paths when switching between repos.',
            'Commit separately inside each repo you modify. Do not mix multiple repos into one commit.',
            'Treat sibling repos as reference-only unless the task clearly requires editing them.',
          ];

    return [
      '<flux-skill name="multi-workspace">',
      '',
      '## Sibling Repositories',
      'This workspace is linked to additional repositories. The current workspace remains the primary repo.',
      '',
      ...siblings.map((sibling, index) =>
        `${index + 1}. \`${sibling.label}\` (${basename(sibling.parentRepo)})\n   Path: \`${sibling.worktreePath}\`\n   Branch: \`${sibling.branch}\`\n   Role: \`${sibling.role}\``,
      ),
      '',
      '## Rules',
      ...modeRules,
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
