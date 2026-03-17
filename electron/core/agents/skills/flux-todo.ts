import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Todo skill — loaded for agents that lack a native todo/task tracking
 * tool (Codex, Copilot, Gemini, OpenAI, Ollama).
 *
 * Instructs the agent to emit structured JSON signals for progress tracking.
 * The Flux UI parses these in real-time to show a progress panel with
 * step-by-step status (pending → in_progress → done).
 *
 * Protocol:
 *   FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Set up DB schema"}
 *   FLUX_SIGNAL: {"type":"step_done","step":1}
 *   FLUX_SIGNAL: {"type":"todo_update","todos":[...]}
 *
 * Both granular (step_start/step_done) and snapshot (todo_update) signals
 * are supported. The snapshot form is easier for agents that prefer to emit
 * full state each time.
 */
export const fluxTodoSkill: FluxSkill = {
  id: 'flux-todo',
  name: 'Flux Todo',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'act' && !ctx.hasNativeTodoTool;
  },

  buildPrompt(ctx: SkillContext): string {
    const lines = [
      '<flux-skill name="todo">',
      '',
      '## Progress Tracking Protocol',
      '',
      'You MUST track your progress by emitting FLUX_SIGNAL JSON lines.',
      'Each signal must be on its own line, outside of any markdown code block.',
      '',
      'There are two signal formats. Pick one and use it consistently.',
      '',
      '### Format A: Granular signals (preferred)',
      '',
      'Emit step_start when you begin a step, and step_done when you finish it.',
      '',
      'Example — starting step 1:',
      '',
      'FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Set up database schema"}',
      '',
      'Example — finishing step 1 and starting step 2:',
      '',
      'FLUX_SIGNAL: {"type":"step_done","step":1}',
      'FLUX_SIGNAL: {"type":"step_start","step":2,"label":"Add API endpoints"}',
      '',
      '### Format B: Full snapshot',
      '',
      'Emit the complete todo list with statuses each time something changes.',
      '',
      'Example:',
      '',
      'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Set up database schema","status":"done"},{"label":"Add API endpoints","status":"in_progress"},{"label":"Write tests","status":"pending"}]}',
      '',
      '### Signal rules',
      '',
      '- Step numbers start at 1 and increment sequentially.',
      '- Labels must be under 50 characters and action-oriented.',
      '- Each FLUX_SIGNAL line must be on its own line, NOT inside a ``` code block.',
      '- Valid statuses are: "pending", "in_progress", "done".',
      '- For snapshot mode, always emit the full list, not just the changed item.',
    ];

    if (ctx.agentId === 'codex' || ctx.agentId === 'copilot') {
      lines.push(
        '',
        '### Quick start',
        '',
        'Before your first step, emit all planned steps at once:',
        '',
        'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Step one","status":"in_progress"},{"label":"Step two","status":"pending"},{"label":"Step three","status":"pending"}]}',
        '',
        'Then emit updates as you complete each step.',
      );
    }

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
