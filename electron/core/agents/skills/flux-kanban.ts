import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Kanban skill — teaches agents to write concise, engineer-to-product
 * status summaries that appear on the kanban board.
 *
 * The summary is written to `.context/state.json` via the `summary` field
 * and displayed directly on the workspace's kanban card.
 */
export const fluxKanbanSkill: FluxSkill = {
  id: 'flux-kanban',
  name: 'Flux Kanban',

  isRelevant(ctx: SkillContext): boolean {
    // Active for any workspace session (plan, act, discover) — not merge actions
    return !!ctx.workspace && ctx.workspaceAction !== 'merge';
  },

  buildPrompt(ctx: SkillContext): string {
    return [
      '<flux-skill name="kanban">',
      '',
      '## Kanban Status Updates',
      '',
      'Your workspace is displayed on a kanban board visible to the product team.',
      'Write a short `summary` field in `.context/state.json` that tells them **what you did and why it matters** — not what they should do next.',
      '',
      '### Voice & tone',
      '',
      '- Write like an engineer reporting to product: direct, factual, no fluff.',
      '- Lead with the outcome, not the process. Say what changed, not what you read.',
      '- Focus on the **feature or behavior** that changed, not implementation details like file names, directories, or line counts.',
      '- Frame summaries in terms of what the user/product gains — not what code was touched.',
      '- Never ask the reader to do something ("please review", "let me know"). Just state what happened.',
      '- Use present perfect or past tense: "Added…", "Fixed…", "Wired up…", "Refactored…".',
      '- One sentence, max two. Under 120 characters is ideal.',
      '',
      '### Examples',
      '',
      '- "Added retry logic to token refresh — sessions no longer drop on transient 401s."',
      '- "Split the monolith settings page into tabbed sub-routes with shared layout."',
      '- "Fixed race condition in workspace polling that caused phantom duplicates."',
      '- "Wired up model selector to agent spawn options — selection persists across restarts."',
      '',
      '### Anti-patterns (do NOT write these)',
      '',
      '- "Please review the changes I made to the auth module." (asks reader to act)',
      '- "I\'ve made some improvements to the codebase." (vague, no outcome)',
      '- "Modified 5 files across 3 directories." (describes process, not impact)',
      '- "Updated flux-kanban.ts and protocol.ts." (lists files instead of describing the change)',
      '- "Refactored electron/core/agents/skills/index.ts to export new skill." (exposes internal paths)',
      '- "Ready for review." (status, not summary)',
      '',
      '### How to write it',
      '',
      'Include `summary` alongside `outcome` and `workspace_name` in `.context/state.json`:',
      '',
      '```json',
      '{',
      '  "outcome": "ready_for_pr",',
      '  "workspace_name": "Fix Token Refresh",',
      '  "summary": "Added retry logic to token refresh — sessions no longer drop on transient 401s."',
      '}',
      '```',
      '',
      'Update the summary whenever the outcome changes or you finish a meaningful chunk of work.',
      '',
      '</flux-skill>',
    ].join('\n');
  },
};
