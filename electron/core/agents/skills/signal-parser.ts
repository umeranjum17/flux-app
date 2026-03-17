import type { FluxSignal, FluxSignalType } from './types';

/**
 * Parse FLUX_SIGNAL JSON lines from agent output.
 *
 * Format: `FLUX_SIGNAL: {"type":"step_start","step":1,"label":"..."}`
 *
 * This is the unified signal protocol used by skills. It coexists with the
 * older FLUX_WORKSPACE_LIFECYCLE and FLUX_TODO protocols for backward compatibility.
 */

const SIGNAL_REGEX = /FLUX_SIGNAL:\s*(\{.*\})/;
const VALID_TYPES = new Set<FluxSignalType>([
  'step_start',
  'step_done',
  'todo_update',
  'completed',
]);

/**
 * Try to extract a FLUX_SIGNAL from a single line or text block.
 * Returns the first valid signal found, or null.
 */
export function parseFluxSignal(text: string): FluxSignal | null {
  for (const line of text.split('\n')) {
    const match = line.match(SIGNAL_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const signalType = parsed.type;
    if (typeof signalType !== 'string' || !VALID_TYPES.has(signalType as FluxSignalType)) continue;

    return normalizeSignal(parsed, signalType as FluxSignalType);
  }

  return null;
}

/**
 * Extract ALL FLUX_SIGNAL events from a multi-line text block.
 */
export function parseAllFluxSignals(text: string): FluxSignal[] {
  const signals: FluxSignal[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(SIGNAL_REGEX);
    if (!match) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const signalType = parsed.type;
    if (typeof signalType !== 'string' || !VALID_TYPES.has(signalType as FluxSignalType)) continue;

    const signal = normalizeSignal(parsed, signalType as FluxSignalType);
    if (signal) signals.push(signal);
  }
  return signals;
}

function normalizeSignal(parsed: Record<string, unknown>, type: FluxSignalType): FluxSignal | null {
  const signal: FluxSignal = { type };

  if (typeof parsed.step === 'number') {
    signal.step = parsed.step;
  }

  if (typeof parsed.label === 'string') {
    signal.label = parsed.label.slice(0, 50);
  }

  if (typeof parsed.workspace_name === 'string') {
    signal.workspace_name = parsed.workspace_name.slice(0, 50);
  }

  if (Array.isArray(parsed.todos)) {
    signal.todos = parsed.todos
      .filter((item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        label: typeof item.label === 'string' ? item.label.slice(0, 50) : 'Step',
        status: normalizeTodoStatus(item.status),
      }))
      .slice(0, 50); // cap at 50 items
  }

  return signal;
}

function normalizeTodoStatus(value: unknown): 'pending' | 'in_progress' | 'done' {
  if (typeof value !== 'string') return 'pending';
  const v = value.toLowerCase().trim();
  if (v === 'done' || v === 'completed' || v === 'complete') return 'done';
  if (v === 'in_progress' || v === 'in-progress' || v === 'active') return 'in_progress';
  return 'pending';
}
