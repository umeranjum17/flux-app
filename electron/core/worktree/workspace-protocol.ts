/**
 * Workspace lifecycle protocol — the structured event contract between
 * agents and Flux for workspace state transitions.
 *
 * Agents emit JSON events on their own line:
 *
 *   FLUX_LIFECYCLE: {"state":"ready_for_review"}
 *
 * These represent high-level workspace lifecycle states, NOT task progress.
 * Task progress (steps, todos) is tracked separately via FLUX_TODO / TodoWrite.
 *
 * Allowed states:
 *   idle            — workspace has no active work
 *   working         — agent is actively coding
 *   ready_for_review — work is done, ready for human review
 *   merged          — changes have been merged
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceLifecycleState =
  | 'idle'
  | 'working'
  | 'ready_for_review'
  | 'merged';

export interface WorkspaceLifecycleEvent {
  state: WorkspaceLifecycleState;
  /** Short workspace name (3-5 words). Optional, used when completing work. */
  workspace_name?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const LIFECYCLE_REGEX = /FLUX_(?:WORKSPACE|LIFECYCLE):\s*(\{.*\})/;
const VALID_STATES = new Set<WorkspaceLifecycleState>([
  'idle',
  'working',
  'ready_for_review',
  'merged',
]);

function parseEventFromLine(line: string): WorkspaceLifecycleEvent | null {
  const match = line.match(LIFECYCLE_REGEX);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const state = parsed.state;
  if (typeof state !== 'string' || !VALID_STATES.has(state as WorkspaceLifecycleState)) return null;

  return {
    state: state as WorkspaceLifecycleState,
    ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
  };
}

/**
 * Try to extract a workspace lifecycle event from a text string.
 * Scans each line for `FLUX_LIFECYCLE: {...}` (or legacy `FLUX_WORKSPACE: {...}`).
 * Returns the first match, or null if none found.
 */
export function parseWorkspaceEvent(text: string): WorkspaceLifecycleEvent | null {
  for (const line of text.split('\n')) {
    const evt = parseEventFromLine(line);
    if (evt) return evt;
  }
  return null;
}

/**
 * Extract ALL workspace lifecycle events from a multi-line text block.
 */
export function parseAllWorkspaceEvents(text: string): WorkspaceLifecycleEvent[] {
  const events: WorkspaceLifecycleEvent[] = [];
  for (const line of text.split('\n')) {
    const evt = parseEventFromLine(line);
    if (evt) events.push(evt);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the workspace lifecycle protocol instructions injected into agent
 * prompts. Agents use these to signal workspace state transitions.
 */
export function buildWorkspaceProtocolPrompt(): string {
  return [
    '## Lifecycle',
    'Signal workspace state transitions by emitting a JSON line:',
    '`FLUX_LIFECYCLE: {"state":"<state>"}`',
    '',
    'Allowed states: `working`, `ready_for_review`',
    '',
    '- Emit `working` when you begin making changes.',
    '- Emit `ready_for_review` when all work is committed and done.',
    '  Optionally include `"workspace_name":"Short Description"` (3-5 words).',
    '',
    'Example:',
    '```',
    'FLUX_LIFECYCLE: {"state":"ready_for_review","workspace_name":"Fix Token Refresh Logic"}',
    '```',
    '',
    'Do NOT use lifecycle events for progress tracking — use your todo/plan tools for that.',
  ].join('\n');
}
