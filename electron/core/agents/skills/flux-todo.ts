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
      'Track your progress by emitting **FLUX_SIGNAL** JSON on its own line.',
      'The Flux UI parses these signals in real-time to display a progress panel.',
      '',
      '### Option A: Granular signals (preferred)',
      'Emit `step_start` when you begin a step and `step_done` when you finish:',
      '```',
      'FLUX_SIGNAL: {"type":"step_start","step":1,"label":"Set up database schema"}',
      '```',
      '...do the work...',
      '```',
      'FLUX_SIGNAL: {"type":"step_done","step":1}',
      'FLUX_SIGNAL: {"type":"step_start","step":2,"label":"Add API endpoints"}',
      '```',
      '',
      '### Option B: Full snapshot',
      'Emit the entire todo list with current statuses each time something changes:',
      '```',
      'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Set up database schema","status":"done"},{"label":"Add API endpoints","status":"in_progress"},{"label":"Write tests","status":"pending"}]}',
      '```',
      '',
      '### Rules',
      '- **Step numbers** start at 1 and increment sequentially.',
      '- **Labels** must be short (under 50 chars) and action-oriented.',
      '- Emit signals on their own line — do not embed them inside markdown blocks.',
      '- For snapshot mode, emit the **full list** each time (not just the changed item).',
      '- Use statuses: `"pending"`, `"in_progress"`, `"done"`.',
    ];

    // Agent-specific tips
    if (ctx.agentId === 'codex' || ctx.agentId === 'copilot') {
      lines.push(
        '',
        '### Quick reference',
        'Before starting your first step, plan out all steps and emit them:',
        '```',
        'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Step one","status":"in_progress"},{"label":"Step two","status":"pending"},{"label":"Step three","status":"pending"}]}',
        '```',
        'Then as you complete each step, emit updates.',
      );
    }

    lines.push('', '</flux-skill>');
    return lines.join('\n');
  },
};
