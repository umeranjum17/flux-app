/**
 * Unified lifecycle event protocol for agent ↔ Flux communication.
 *
 * All downstream agents (Claude Code, Codex, Copilot, etc.) are instructed to
 * emit structured JSON lifecycle events as text lines:
 *
 *   FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Set up DB schema"}
 *
 * These are parsed from agent text output and mapped to lifecycle manager
 * calls, progress tracking, and workspace naming — replacing the per-agent
 * TodoWrite / [STEP N START] / WORKSPACE_NAME: protocols with one unified
 * contract.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FluxLifecycleEventType =
  | 'step_start'
  | 'step_done'
  | 'completed';

export interface FluxLifecycleEvent {
  event: FluxLifecycleEventType;
  /** Step number (1-indexed). Required for step_start / step_done. */
  step?: number;
  /** Short label for the step (under 50 chars). Used with step_start. */
  label?: string;
  /** Short workspace name (3-5 words). Used with completed. */
  workspace_name?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const LIFECYCLE_REGEX = /FLUX_LIFECYCLE:\s*(\{.*\})/;
const VALID_EVENTS = new Set<FluxLifecycleEventType>([
  'step_start',
  'step_done',
  'completed',
]);

/**
 * Try to extract a lifecycle event from a text string.
 * Scans each line for `FLUX_LIFECYCLE: {...}`.
 * Returns the first match, or null if none found.
 */
export function parseLifecycleEvent(text: string): FluxLifecycleEvent | null {
  for (const line of text.split('\n')) {
    const match = line.match(LIFECYCLE_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const eventType = parsed.event;
    if (typeof eventType !== 'string' || !VALID_EVENTS.has(eventType as FluxLifecycleEventType)) continue;

    return {
      event: eventType as FluxLifecycleEventType,
      ...(typeof parsed.step === 'number' ? { step: parsed.step } : {}),
      ...(typeof parsed.label === 'string' ? { label: parsed.label.slice(0, 50) } : {}),
      ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
    };
  }

  return null;
}

/**
 * Extract ALL lifecycle events from a multi-line text block.
 * Useful for scanning an entire agent response.
 */
export function parseAllLifecycleEvents(text: string): FluxLifecycleEvent[] {
  const events: FluxLifecycleEvent[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(LIFECYCLE_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const eventType = parsed.event;
    if (typeof eventType !== 'string' || !VALID_EVENTS.has(eventType as FluxLifecycleEventType)) continue;

    events.push({
      event: eventType as FluxLifecycleEventType,
      ...(typeof parsed.step === 'number' ? { step: parsed.step } : {}),
      ...(typeof parsed.label === 'string' ? { label: parsed.label.slice(0, 50) } : {}),
      ...(typeof parsed.workspace_name === 'string' ? { workspace_name: parsed.workspace_name.slice(0, 50) } : {}),
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the lifecycle protocol instructions injected into agent prompts.
 * Replaces the old per-agent TodoWrite / [STEP N START] / WORKSPACE_NAME
 * instructions with one unified JSON protocol.
 */
export function buildLifecyclePrompt(): string {
  return [
    '## Progress & Lifecycle',
    'Report your progress by emitting lifecycle events as JSON on their own line.',
    'Format: `FLUX_LIFECYCLE: {"event":"<type>", ...}`',
    '',
    '### Events',
    '',
    '**step_start** — Emit when you begin a distinct step of work.',
    '```',
    'FLUX_LIFECYCLE: {"event":"step_start","step":1,"label":"Set up database schema"}',
    '```',
    '',
    '**step_done** — Emit when you complete a step.',
    '```',
    'FLUX_LIFECYCLE: {"event":"step_done","step":1}',
    '```',
    '',
    '**completed** — Emit once at the very end when all work is finished.',
    'Include a short workspace name (3-5 words) describing what was done.',
    '```',
    'FLUX_LIFECYCLE: {"event":"completed","workspace_name":"Fix Token Refresh Logic"}',
    '```',
    '',
    '### Rules',
    '- Emit `step_start` before beginning each logical step.',
    '- Emit `step_done` after completing each step.',
    '- Always emit `completed` as the very last thing in your final response.',
    '- Step labels should be short (under 50 chars) and action-oriented.',
    '- Step numbers start at 1 and increment sequentially.',
  ].join('\n');
}
