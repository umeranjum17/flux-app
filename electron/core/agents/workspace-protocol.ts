/**
 * Workspace state protocol for agent → Flux communication.
 *
 * Agents emit `FLUX_WORKSPACE: {"state":"<state>", ...}` lines to report
 * their workspace lifecycle state.  This is separate from progress/todo
 * tracking (FLUX_TODO / TodoWrite) — it tells Flux *where* the workspace
 * is in its lifecycle, not what steps are being worked on.
 *
 * Valid states:
 *   working          — agent is actively working
 *   ready_for_review — agent has finished and the workspace is ready for review
 *   completed        — all work is done (includes workspace_name)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FluxWorkspaceState =
  | 'working'
  | 'ready_for_review'
  | 'completed';

export interface FluxWorkspaceEvent {
  state: FluxWorkspaceState;
  /** Short workspace name (3-5 words). Used with completed. */
  workspace_name?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// Match both new FLUX_WORKSPACE and legacy FLUX_LIFECYCLE prefixes
const WORKSPACE_REGEX = /FLUX_(?:WORKSPACE|LIFECYCLE):\s*(\{.*\})/;
const VALID_STATES = new Set<FluxWorkspaceState>([
  'working',
  'ready_for_review',
  'completed',
]);

// Map legacy FLUX_LIFECYCLE event types to workspace states
const LEGACY_EVENT_TO_STATE: Record<string, FluxWorkspaceState> = {
  step_start: 'working',
  step_done: 'working',
  completed: 'completed',
};

/**
 * Try to extract a workspace state event from a text string.
 * Scans each line for `FLUX_WORKSPACE: {...}`.
 * Returns the first match, or null if none found.
 */
export function parseWorkspaceEvent(text: string): FluxWorkspaceEvent | null {
  for (const line of text.split('\n')) {
    const match = line.match(WORKSPACE_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    // Try new format first (state field)
    if (typeof parsed.state === 'string' && VALID_STATES.has(parsed.state as FluxWorkspaceState)) {
      return {
        state: parsed.state as FluxWorkspaceState,
        ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
      };
    }

    // Legacy format: map event field to state
    if (typeof parsed.event === 'string' && parsed.event in LEGACY_EVENT_TO_STATE) {
      return {
        state: LEGACY_EVENT_TO_STATE[parsed.event],
        ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
      };
    }
  }

  return null;
}

/**
 * Extract ALL workspace state events from a multi-line text block.
 */
export function parseAllWorkspaceEvents(text: string): FluxWorkspaceEvent[] {
  const events: FluxWorkspaceEvent[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(WORKSPACE_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    // Try new format first (state field)
    if (typeof parsed.state === 'string' && VALID_STATES.has(parsed.state as FluxWorkspaceState)) {
      events.push({
        state: parsed.state as FluxWorkspaceState,
        ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
      });
      continue;
    }

    // Legacy format: map event field to state
    if (typeof parsed.event === 'string' && parsed.event in LEGACY_EVENT_TO_STATE) {
      events.push({
        state: LEGACY_EVENT_TO_STATE[parsed.event],
        ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build workspace state protocol instructions injected into agent prompts.
 * Tells agents how to report workspace lifecycle state — NOT progress/todos.
 */
export function buildWorkspacePrompt(): string {
  return [
    '## Workspace State',
    'Report your workspace lifecycle state by emitting a JSON line with the prefix `FLUX_WORKSPACE:`.',
    'This is NOT for progress tracking (use your normal todo/step tools for that).',
    'This tells Flux where the workspace is in its lifecycle.',
    '',
    '### States',
    '',
    '**working** — Emit when you begin working.',
    '```',
    'FLUX_WORKSPACE: {"state":"working"}',
    '```',
    '',
    '**ready_for_review** — Emit when you have finished making changes and the workspace is ready for review.',
    '```',
    'FLUX_WORKSPACE: {"state":"ready_for_review"}',
    '```',
    '',
    '**completed** — Emit once at the very end when all work is finished.',
    'Include a short workspace name (3-5 words) describing what was done.',
    '```',
    'FLUX_WORKSPACE: {"state":"completed","workspace_name":"Fix Token Refresh Logic"}',
    '```',
    '',
    '### Rules',
    '- Emit `working` when you start working on the task.',
    '- Emit `ready_for_review` after committing your changes, before your final summary.',
    '- Always emit `completed` as the very last thing in your final response.',
    '- Do NOT confuse this with progress/todo tracking — this is only for workspace state.',
  ].join('\n');
}
