import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Terminal skill — lets agents run shell commands and manage background
 * processes through the `.context/requests/` file protocol.
 *
 * Useful for:
 * - Agents without a native Bash tool (Gemini, OpenAI, Ollama)
 * - Running persistent processes (dev servers, watchers) from any agent
 * - Making terminal output visible in the Flux UI
 */
export const fluxTerminalSkill: FluxSkill = {
  id: 'flux-terminal',
  name: 'Flux Terminal',

  isRelevant(ctx: SkillContext): boolean {
    return ctx.mode === 'act' && !!ctx.workspace;
  },

  buildPrompt(_ctx: SkillContext): string {
    const lines = [
      '<flux-skill name="terminal">',
      '',
      '## Flux Terminal',
      '',
      'Run shell commands through Flux\'s integrated terminal by writing request files.',
      'Commands execute in the workspace directory and output is visible in the Flux UI.',
      '',
      '### Run a command (wait for output)',
      '',
      'Write a request file to `.context/requests/<id>.json`:',
      '',
      '```json',
      '{',
      '  "id": "t1",',
      '  "action": "terminal:exec",',
      '  "payload": { "command": "npm test" }',
      '}',
      '```',
      '',
      'Then read the response from `.context/responses/t1.json`:',
      '',
      '```json',
      '{',
      '  "id": "t1",',
      '  "ok": true,',
      '  "data": { "stdout": "...", "stderr": "...", "exitCode": 0 }',
      '}',
      '```',
      '',
      '### Start a background process (dev server, watcher)',
      '',
      '```json',
      '{',
      '  "id": "t2",',
      '  "action": "terminal:spawn",',
      '  "payload": { "command": "npm run dev" }',
      '}',
      '```',
      '',
      'Response includes a `terminalId`. Use `terminal:kill` to stop it:',
      '',
      '```json',
      '{',
      '  "id": "t3",',
      '  "action": "terminal:kill",',
      '  "payload": { "terminalId": "<id-from-spawn-response>" }',
      '}',
      '```',
      '',
      '### Rules',
      '',
      '- Create `.context/requests/` before writing (`mkdir -p .context/requests`).',
      '- Use unique IDs (`t1`, `t2`, `t3`, or any string).',
      '- `terminal:exec` times out after 30s by default (set `timeout` in ms, max 5 min).',
      '- Output is truncated to 100KB per stream.',
      '- Response files appear within ~1s after the request is processed.',
      '- If you have a native shell/Bash tool, prefer it for simple one-off commands.',
      '- Use `terminal:spawn` for long-running processes that should persist.',
      '',
      '</flux-skill>',
    ];
    return lines.join('\n');
  },
};
