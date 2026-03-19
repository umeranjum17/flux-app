import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Context skill — loaded for any workspace-backed task.
 *
 * Gives every agent a consistent view of the `.context/` directory layout
 * so that plan, act, ask, and architect modes all know how to discover
 * and (when appropriate) write Flux-managed context files.
 */
export const fluxContextSkill: FluxSkill = {
  id: 'flux-context',
  name: 'Flux Context',

  isRelevant(ctx: SkillContext): boolean {
    return !!ctx.workspace;
  },

  buildPrompt(ctx: SkillContext): string {
    const isWriteMode = ctx.mode === 'plan' || ctx.mode === 'act';

    const lines = [
      '<flux-skill name="context">',
      '',
      '## `.context/` Directory',
      '',
      'Flux maintains a `.context/` directory in the workspace root for crash-resilient',
      'context storage. It is gitignored — never commit its contents.',
      '',
      '### Files',
      '',
      '| File | Purpose | Present when |',
      '|------|---------|--------------|',
      '| `.context/session-context.md` | Auto-written by Flux with session metadata, files discussed, recent actions, and last assistant response. | Always (written on task start and periodically). |',
      '| `.context/plan.md` | The approved plan for this workspace. Written by the plan-mode agent, read by the act-mode agent. | After a plan is produced or approved. |',
      '| `.context/attachments.json` | Machine-readable manifest of user-attached images and files. | When the user attached images or files. |',
      '| `.context/attachments.md` | Human-readable attachment previews (fallback if JSON missing). | When the user attached images or files. |',
      '| `.context/attachments/` | Materialized image files (`image-N.ext`). | When the user attached images. |',
      '',
      '### Discovery',
      '',
      '- On resume or after context compression, read `.context/session-context.md` to recover prior session state.',
      '- If attachments are expected, read `.context/attachments.json` for the manifest.',
      '- In act mode, read `.context/plan.md` for the approved plan if it is not already in your conversation.',
    ];

    if (isWriteMode) {
      lines.push(
        '',
        '### Writing',
        '',
        '- Create the directory first: `mkdir -p .context`',
      );

      if (ctx.mode === 'plan') {
        lines.push(
          '- After outputting your plan, persist it to `.context/plan.md` so the act-phase agent can read it.',
        );
      }
    }

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
