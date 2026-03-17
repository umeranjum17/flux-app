import type { AgentMessage, TodoItem } from './types';

// Match entire FLUX signal lines, including nested JSON payloads.
const FLUX_LINE_PATTERN = /^\s*FLUX_(?:WORKSPACE_LIFECYCLE|WORKSPACE|LIFECYCLE|SIGNAL):\s*\{.*$/gm;

// Match orphaned closing braces left behind when a streamed FLUX signal was
// split across chunks and only the closing fragment landed in this message.
const ORPHAN_JSON_CLOSER = /^\s*["']?\}\s*$/gm;

/** Strip FLUX protocol tokens so they don't leak into plan text. */
export function stripFluxTokens(text: string): string {
  let cleaned = text.replace(FLUX_LINE_PATTERN, '');
  cleaned = cleaned.replace(ORPHAN_JSON_CLOSER, '');
  return cleaned.replace(/\n{3,}/g, '\n\n');
}

const PLAN_SECTION_PATTERN = /^(#{2,3})\s+(summary|analysis|steps|trade-offs|tradeoffs|verification)\b/im;
const GENERIC_SECTION_PATTERN = /^#{2,3}\s+\S+/gm;
const ORDERED_STEP_PATTERN = /^\d+\.\s+\S+/gm;
const BULLET_STEP_PATTERN = /^[-*]\s+\S+/gm;

export function isLikelyPlanText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 80) {
    return false;
  }

  const planSectionCount = countMatches(normalized, PLAN_SECTION_PATTERN);
  const genericSectionCount = countMatches(normalized, GENERIC_SECTION_PATTERN);
  const orderedStepCount = countMatches(normalized, ORDERED_STEP_PATTERN);
  const bulletStepCount = countMatches(normalized, BULLET_STEP_PATTERN);

  if (planSectionCount >= 2 && (orderedStepCount >= 1 || bulletStepCount >= 3)) {
    return true;
  }

  if (genericSectionCount >= 3 && orderedStepCount >= 1) {
    return true;
  }

  return orderedStepCount >= 3 && normalized.length >= 160;
}

export function getLatestPlanText(messages: AgentMessage[]): string {
  const assistantTexts = messages
    .filter((message) => message.role === 'assistant' && message.type === 'text')
    .map((message) => message.content.trim())
    .filter(Boolean);

  for (let index = assistantTexts.length - 1; index >= 0; index -= 1) {
    if (isLikelyPlanText(assistantTexts[index])) {
      return stripFluxTokens(assistantTexts[index]);
    }
  }

  return '';
}

export function isPlanMessage(message: AgentMessage, taskMode?: 'plan' | 'act'): boolean {
  return taskMode === 'plan'
    && message.role === 'assistant'
    && message.type === 'text'
    && isLikelyPlanText(message.content);
}

/**
 * Clean a raw numbered-item title for display. Extracts the bold prefix
 * if the model wrote `**Title**: details`, otherwise truncates long titles.
 */
function cleanStepLabel(raw: string): string {
  const boldMatch = raw.match(/^\*\*(.+?)\*\*\s*[:–—-]/);
  if (boldMatch) return boldMatch[1].trim();
  const codeMatch = raw.match(/^`(.+?)`\s*[:–—-]/);
  if (codeMatch) return codeMatch[1].trim();
  if (raw.length > 80) return raw.slice(0, 80).replace(/\s+\S*$/, '').trim();
  return raw;
}

/**
 * Extract numbered steps from plan text into TodoItem entries.
 * Looks for the "Steps" section first; falls back to all numbered lines.
 */
export function extractPlanSteps(planText: string): TodoItem[] {
  const stepsSection = planText.match(/^#{2,3}\s+Steps?\b[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|\z)/im);
  const source = stepsSection ? stepsSection[1] : planText;
  const items: TodoItem[] = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      items.push({ id: items.length + 1, label: cleanStepLabel(match[1].trim()), status: 'pending' });
    }
  }
  return items;
}

function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
  return Array.from(text.matchAll(globalPattern)).length;
}
