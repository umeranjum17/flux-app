/**
 * .context/state.json protocol — the single contract between agents and Flux.
 *
 * Agents write this file using their native Write/file tools.
 * Flux polls it for changes and reacts to state transitions.
 */

// ---------------------------------------------------------------------------
// State protocol (agent → Flux via .context/state.json)
// ---------------------------------------------------------------------------

export type ContextTodoStatus = 'pending' | 'in_progress' | 'done';

export interface ContextTodoItem {
  label: string;
  status: ContextTodoStatus;
}

export type ContextOutcome = 'in_progress' | 'planned' | 'ready_for_pr';

export interface ContextState {
  /** Short workspace display name (3-5 words, title case). */
  workspace_name?: string;
  /** Current workspace outcome. */
  outcome?: ContextOutcome;
  /** Progress tracking items. */
  todos?: ContextTodoItem[];
}

// ---------------------------------------------------------------------------
// Request/response protocol (agent ↔ Flux via .context/requests/ and .context/responses/)
// ---------------------------------------------------------------------------

export interface ContextRequest {
  /** Unique request ID (UUID). */
  id: string;
  /** Action type — extensible, new actions just need a handler. */
  action: string;
  /** Action-specific payload. */
  payload?: Record<string, unknown>;
}

export interface ContextResponse {
  /** Matching request ID. */
  id: string;
  /** Whether the request succeeded. */
  ok: boolean;
  /** Action-specific result data. */
  data?: Record<string, unknown>;
  /** Error message on failure. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_OUTCOMES = new Set<ContextOutcome>(['in_progress', 'planned', 'ready_for_pr']);

/**
 * Parse and validate raw JSON into a ContextState.
 * Returns null for invalid/malformed input rather than throwing.
 */
export function parseContextState(raw: unknown): ContextState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const state: ContextState = {};

  if (typeof obj.workspace_name === 'string') {
    state.workspace_name = obj.workspace_name.slice(0, 50);
  }

  if (typeof obj.outcome === 'string' && VALID_OUTCOMES.has(obj.outcome as ContextOutcome)) {
    state.outcome = obj.outcome as ContextOutcome;
  }

  if (Array.isArray(obj.todos)) {
    state.todos = obj.todos
      .filter((item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        label: typeof item.label === 'string' ? item.label.slice(0, 50) : 'Step',
        status: normalizeTodoStatus(item.status),
      }))
      .slice(0, 50);
  }

  return state;
}

export function hasContextStatePayload(state: ContextState): boolean {
  return typeof state.workspace_name === 'string'
    || typeof state.outcome === 'string'
    || Array.isArray(state.todos);
}

function normalizeTodoStatus(value: unknown): ContextTodoStatus {
  if (typeof value !== 'string') return 'pending';
  const v = value.toLowerCase().trim();
  if (v === 'done' || v === 'completed' || v === 'complete') return 'done';
  if (v === 'in_progress' || v === 'in-progress' || v === 'active') return 'in_progress';
  return 'pending';
}

/**
 * Parse and validate a ContextRequest from raw JSON.
 */
export function parseContextRequest(raw: unknown): ContextRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || typeof obj.action !== 'string') return null;

  return {
    id: obj.id,
    action: obj.action,
    payload: (obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload))
      ? obj.payload as Record<string, unknown>
      : undefined,
  };
}
