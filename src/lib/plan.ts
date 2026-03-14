import type { AgentMessage } from './types';

const PLAN_SECTION_PATTERN = /^(#{2,3})\s+(summary|analysis|steps|trade-offs|tradeoffs)\b/im;
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
      return assistantTexts[index];
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

function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = pattern.global
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
  return Array.from(text.matchAll(globalPattern)).length;
}
