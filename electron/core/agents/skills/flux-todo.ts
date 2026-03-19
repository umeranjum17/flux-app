import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Todo skill — loaded for agents that lack a native todo/task tracking
 * tool (Codex, Copilot, Gemini, OpenAI, Ollama).
 *
 * Instructs the agent to write progress to `.context/state.json` using its
 * native file-writing tool. Flux polls this file and updates the UI.
 */
export const fluxTodoSkill: FluxSkill = {
  id: 'flux-todo',
  name: 'Flux Todo',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'act' && !ctx.hasNativeTodoTool;
  },

  buildPrompt(_ctx: SkillContext): string {
    const lines = [
      '<flux-skill name="todo">',
      '',
      '## Progress Tracking',
      '',
      'Track your progress by writing to `.context/state.json` using your Write tool.',
      'Create the directory first (`mkdir -p .context`) if it does not exist.',
      '',
      'Update the `todos` array as you work. Flux polls this file and shows a live progress panel.',
      '',
      '```json',
      '{',
      '  "todos": [',
      '    { "label": "Set up database schema", "status": "done" },',
      '    { "label": "Add API endpoints", "status": "in_progress" },',
      '    { "label": "Write tests", "status": "pending" }',
      '  ]',
      '}',
      '```',
      '',
      '### Rules',
      '',
      '- Labels must be under 50 characters and action-oriented.',
      '- Valid statuses: `"pending"`, `"in_progress"`, `"done"`.',
      '- Always write the full list (not just the changed item).',
      '- Write the file before your first step with all planned steps, then update as you go.',
      '',
      '</flux-skill>',
    ];
    return lines.join('\n');
  },
};
