import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Attachments skill — loaded when the user attached images or files
 * that were persisted to `.context/`.
 *
 * Gives the agent a clear, structured description of what is on disk so it
 * can discover and read attachment artifacts without parsing markdown.
 */
export const fluxAttachmentsSkill: FluxSkill = {
  id: 'flux-attachments',
  name: 'Flux Attachments',

  isRelevant(ctx: SkillContext): boolean {
    return !!ctx.attachments;
  },

  buildPrompt(ctx: SkillContext): string {
    const att = ctx.attachments!;
    const lines = [
      '<flux-skill name="attachments">',
      '',
      '## User Attachments',
      '',
      'The user attached files or images to this conversation.',
      'Flux persisted them to the `.context/` directory in the workspace so you can access them from disk.',
      '',
      '### Machine-readable manifest',
      '',
      `\`.context/attachments.json\` contains a JSON array describing every attachment (type, name, path, size, truncation status).`,
      'Read it with `cat .context/attachments.json` to enumerate all attachments programmatically.',
      '',
      '### Attachment details',
      '',
    ];

    if (att.imageCount > 0) {
      lines.push(
        `- **Images (${att.imageCount})**: materialized at \`.context/attachments/image-N.ext\`.`,
        '  These are the original image files decoded from the user\'s paste or file picker input.',
      );
    }

    if (att.fileCount > 0) {
      lines.push(
        `- **File attachments (${att.fileCount})**: the manifest lists each file's original path.`,
        '  Read the source files directly for full content. Truncated previews are in `.context/attachments.md`.',
      );
    }

    lines.push(
      '',
      '### Fallback',
      '',
      'If `.context/attachments.json` is missing (older session), fall back to `.context/attachments.md` for a human-readable summary.',
      '',
      '</flux-skill>',
    );

    return lines.join('\n');
  },
};
