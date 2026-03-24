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
    const pullCommand = `git pull --no-rebase origin ${merge.targetBranch}`;
    const squashResetCommand = `git reset --soft origin/${merge.targetBranch}`;
    const updateLocalBranchCommand = `git fetch . HEAD:${merge.targetBranch}`;
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
      `1. Run every git command from the workspace worktree at \`${ws.worktreePath}\`. Do NOT switch to \`${merge.targetBranch}\` in the parent repo.`,
      `2. Stay on the workspace branch \`${ws.branch}\`. Confirm it with \`git branch --show-current\` before merging.`,
      `3. Commit any uncommitted changes (staged or unstaged) in the worktree before proceeding. Use \`git add -A && git commit -m "wip: save uncommitted work before merge"\` if there are changes. Skip if the worktree is clean.`,
      `4. Pull the latest target branch into the worktree with \`${pullCommand}\`. This should bring \`${merge.targetBranch}\` into \`${ws.branch}\`, not move HEAD onto \`${merge.targetBranch}\`.`,
      `5. Review the incoming work with \`git log --oneline HEAD@{1}..HEAD\` or an equivalent diff after the pull.`,
      merge.squash
        ? `6. After the pull succeeds, collapse the final worktree diff into one commit with \`${squashResetCommand}\`, then create a descriptive commit message using the format \`merge(${merge.targetBranch}): <concise summary of what changed>\`.`
        : '6. If the pull created conflicts, resolve them directly inside the worktree and finish the merge commit there.',
      merge.squash
        ? '7. Resolve straightforward conflicts directly inside the worktree before the squash commit. If the merge needs a human decision, stop and report exactly what is blocked.'
        : `7. If a merge commit message needs adjustment, use the format \`merge(${merge.targetBranch}): <concise summary of what changed>\`. Do NOT use generic labels like "Workspace". If the merge needs a human decision, stop and report exactly what is blocked.`,
      `8. Update the local \`${merge.targetBranch}\` branch to match the merged result with \`${updateLocalBranchCommand}\`. This fast-forwards the local branch without checking it out.`,
      `9. Push the updated local branch with \`${pushCommand}\`.`,
      '10. Run `git status` and confirm the merge landed cleanly.',
      '',
      '## Important',
      '- If step 8 fails because `${merge.targetBranch}` is checked out in the parent repo, fall back to `git push origin HEAD:${merge.targetBranch}` and then run `cd ${ws.parentRepo} && git pull --ff-only` to sync the parent.',
      '- If any step fails with an error you cannot resolve, stop immediately and report the exact error.',
      '- Do NOT silently continue past failures.',
      '- Finish with a short summary of what landed, including the merge commit hash (or squash commit hash) and the key files changed.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
