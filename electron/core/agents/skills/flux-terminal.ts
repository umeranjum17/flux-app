import type { FluxSkill, SkillContext } from './types';

/**
 * Flux Terminal skill — lets agents run shell commands and manage background
 * processes through the `.context/requests/` file protocol.
 *
 * Useful for:
 * - Commands that should run in a real Flux terminal
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
      'Commands execute in the workspace directory.',
      'Use Flux Terminal for commands that should run in a real workspace terminal, especially long-running, background, or user-visible tasks.',
      '',
      '### Run a command in the Flux terminal',
      '',
      'Use `terminal:spawn` when the user should see the command in the terminal panel, including project runs, tests, typechecks, and final verification commands:',
      '',
      '```json',
      '{',
      '  "id": "t1",',
      '  "action": "terminal:spawn",',
      '  "payload": { "command": "npm test" }',
      '}',
      '```',
      '',
      '### Start a long-running background process (dev server, watcher)',
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
      '- Response files appear within ~1s after the request is processed.',
      '- If you have a native shell/Bash tool, you may use it for quick one-off inspection or file-system queries.',
      '- Prefer Flux Terminal when the command needs a real terminal, should keep running, or the user should see the live output.',
      '- Use `terminal:spawn` for long-running or visible commands such as dev servers, watch tasks, builds with live logs, and similar background work.',
      '- Use `terminal:spawn` for long-running processes that should persist.',
      '- Treat `terminal:spawn` commands as non-interactive, self-contained shell lines; do not rely on follow-up keystrokes to finish setup.',
      '- Wait for the `.context/responses/<id>.json` file before issuing follow-up actions that depend on the spawned terminal ID.',
      '',
      '</flux-skill>',
    ];
    return lines.join('\n');
  },
};
