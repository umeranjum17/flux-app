import type { FluxSignal, FluxSignalType } from './types';

/**
 * Parse FLUX_SIGNAL JSON lines from agent output.
 *
 * Format: `FLUX_SIGNAL: {"type":"step_start","step":1,"label":"..."}`
 *
 * This is the unified signal protocol used by skills. It coexists with the
 * older FLUX_WORKSPACE_LIFECYCLE and FLUX_TODO protocols for backward compatibility.
 */

const VALID_TYPES = new Set<FluxSignalType>([
  'step_start',
  'step_done',
  'todo_update',
  'completed',
  'outcome',
]);
const SIGNAL_PREFIX = 'FLUX_SIGNAL:';

/**
 * Try to extract a FLUX_SIGNAL from a single line or text block.
 * Returns the first valid signal found, or null.
 */
export function parseFluxSignal(text: string): FluxSignal | null {
  for (const payload of extractSignalPayloads(text)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
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
 *
 * @param typeFilter — when provided, only signals whose type is in this set
 *   are returned. Use this to parse only progress signals mid-stream and
 *   defer completion signals to turn end.
 */
export function parseAllFluxSignals(text: string, typeFilter?: Set<FluxSignalType>): FluxSignal[] {
  const signals: FluxSignal[] = [];
  for (const payload of extractSignalPayloads(text)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const signalType = parsed.type;
    if (typeof signalType !== 'string' || !VALID_TYPES.has(signalType as FluxSignalType)) continue;
    if (typeFilter && !typeFilter.has(signalType as FluxSignalType)) continue;

    const signal = normalizeSignal(parsed, signalType as FluxSignalType);
    if (signal) signals.push(signal);
  }
  return signals;
}

function extractSignalPayloads(text: string): string[] {
  const payloads: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const prefixIdx = text.indexOf(SIGNAL_PREFIX, cursor);
    if (prefixIdx === -1) break;

    if (prefixIdx > 0 && !/\s/.test(text[prefixIdx - 1])) {
      cursor = prefixIdx + SIGNAL_PREFIX.length;
      continue;
    }

    let jsonStart = prefixIdx + SIGNAL_PREFIX.length;
    while (jsonStart < text.length && /\s/.test(text[jsonStart])) {
      jsonStart += 1;
    }

    if (text[jsonStart] !== '{') {
      cursor = jsonStart + 1;
      continue;
    }

    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd === -1) {
      break;
    }

    payloads.push(text.slice(jsonStart, jsonEnd + 1));
    cursor = jsonEnd + 1;
  }

  return payloads;
}

function findJsonObjectEnd(text: string, startIdx: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
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

  if (typeof parsed.outcome === 'string') {
    signal.outcome = parsed.outcome;
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
