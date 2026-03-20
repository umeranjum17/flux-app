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

    const repoList = siblings.map((sibling, index) =>
      [
        `${index + 1}. **${sibling.label}** (\`${basename(sibling.parentRepo)}\`)`,
        `   - Path: \`${sibling.worktreePath}\``,
        `   - Branch: \`${sibling.branch}\``,
        `   - Role: ${sibling.role}`,
        `   - Outcome: ${sibling.outcome}`,
      ].join('\n'),
    );

    const modeRules =
      ctx.mode === 'plan'
        ? [
            '- Read the primary repo and any sibling repos needed for the feature before producing the plan.',
            '- Call out cross-repo dependencies explicitly so the implementation phase can execute them in order.',
            '- Note which repos will need changes and what kind (new files, API changes, config updates, etc.).',
          ]
        : [
            '- You have **full read and write access** to all linked repos. You can and should edit files in sibling repos when the task requires it.',
            '- Use **absolute paths** when reading or editing files in sibling repos (e.g. `Read /absolute/path/to/sibling/file.ts`).',
            '- Commit separately inside each repo you modify. Do not mix multiple repos into one commit.',
            '- When making cross-repo changes, implement the dependency side first (e.g. the API or shared library), then the consumer side.',
          ];

    return [
      '<flux-skill name="multi-workspace">',
      '',
      '## Linked Repositories',
      '',
      'This workspace is part of a multi-repo group. You are working across multiple repositories simultaneously.',
      'Each linked workspace is a separate git worktree with its own branch and working directory.',
      '',
      ...repoList,
      '',
      '## How to Work Across Repos',
      '',
      '- Your primary workspace is the one you were spawned in. Sibling repos listed above are fully accessible.',
      '- To read files in a sibling repo, use the absolute path shown above (e.g. `Read {path}/src/index.ts`).',
      '- To edit files in a sibling repo, use the same absolute paths with the Edit or Write tools.',
      '- To run commands in a sibling repo, `cd` to its path or use absolute paths.',
      '- Each repo may have its own instruction file, such as `AGENTS.md` or `CLAUDE.md` — read it before making changes.',
      '',
      '## Rules',
      '',
      ...modeRules,
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
