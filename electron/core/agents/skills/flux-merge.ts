import type { FluxSkill, SkillContext } from './types';

export const fluxMergeSkill: FluxSkill = {
  id: 'flux-merge',
  name: 'Flux Merge',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.workspaceAction === 'merge' && !!ctx.workspace && !!ctx.merge;
  },

  buildPrompt(ctx: SkillContext): string {
    const ws = ctx.workspace!;
    const merge = ctx.merge!;
    const mergeCommand = merge.squash
      ? `git merge --squash ${ws.branch}`
      : `git merge ${ws.branch} --no-edit`;
    const pushCommand = `git push origin ${merge.targetBranch}`;

    return [
      '<flux-skill name="merge" mode="act">',
      '',
      '## Merge Context',
      'This task is an agent-driven workspace merge. Do NOT use any direct-merge UI flow.',
      '',
      '| Property | Value |',
      '|----------|-------|',
      `| Workspace branch | \`${ws.branch}\` |`,
      `| Working directory | \`${ws.worktreePath}\` |`,
      `| Parent repository | \`${ws.parentRepo}\` |`,
      `| Target branch | \`${merge.targetBranch}\` |`,
      `| Strategy | \`${merge.squash ? 'squash' : 'merge commit'}\` |`,
      '',
      '## Merge Rules',
      '',
      `1. Run the merge from the parent repo at \`${ws.parentRepo}\`, not the worktree path.`,
      `2. In the worktree at \`${ws.worktreePath}\`, commit any uncommitted changes (staged or unstaged) before proceeding. Use \`git add -A && git commit -m "wip: save uncommitted work before merge"\` if there are changes. Skip if the worktree is clean.`,
      `3. \`git checkout ${merge.targetBranch}\``,
      `4. Review the incoming work with \`git log --oneline ${merge.targetBranch}..${ws.branch}\` before merging.`,
      `5. Run \`${mergeCommand}\`.`,
      `6. If the merge does not create a commit automatically (for example after \`--squash\`), write a descriptive commit message using the format \`merge(${merge.targetBranch}): <concise summary of what changed>\`. Do NOT use generic labels like "Workspace".`,
      '7. Handle straightforward conflicts if they come up. If the merge needs a human decision, stop and report exactly what is blocked.',
      `8. Push with \`${pushCommand}\`.`,
      '9. Run `git status` and confirm the merge landed cleanly.',
      '',
      '## Important',
      '- If any step fails with an error you cannot resolve, stop immediately and report the exact error.',
      '- Do NOT silently continue past failures.',
      '- Finish with a short summary of what landed, including the merge commit hash (or squash commit hash) and the key files changed.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
