import type { QuestionField } from './types';

/**
 * Strip the `mcp__<server>__` prefix from an MCP tool name to get the base
 * tool name.  Non-MCP names pass through unchanged.
 */
export function extractMcpToolBaseName(name: string): string {
  if (name.startsWith('mcp__')) {
    const lastSep = name.lastIndexOf('__');
    if (lastSep > 4) return name.slice(lastSep + 2);
  }
  return name;
}

export function isQuestionToolName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const baseName = extractMcpToolBaseName(name);
  return baseName === 'AskUserQuestion' || baseName === 'request_user_input';
}

const INTERACTIVE_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'request_user_input',
  'ExitPlanMode',
  'EnterPlanMode',
  'DiffComment',
]);

/** Tools that require user interaction and should pause stall detection. */
export function isInteractiveToolName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return INTERACTIVE_TOOL_NAMES.has(extractMcpToolBaseName(name));
}

export function normalizeClaudeQuestions(input: Record<string, any>): QuestionField[] {
  const rawQuestions = Array.isArray(input.questions)
    ? input.questions
    : typeof input.question === 'string'
      ? [input]
      : [];

  return rawQuestions
    .filter((question: unknown): question is Record<string, any> => !!question && typeof question === 'object' && !Array.isArray(question))
    .map((question: Record<string, any>) => {
      const options = Array.isArray(question.options)
        ? question.options
          .filter((option: unknown): option is Record<string, any> => !!option && typeof option === 'object' && !Array.isArray(option))
          .map((option: Record<string, any>) => ({
            label: typeof option.label === 'string' ? option.label : String(option.value ?? ''),
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
            ...(typeof option.value === 'string' ? { value: option.value } : {}),
          }))
          .filter((option: { label: string }) => option.label.trim().length > 0)
        : undefined;
      const allowFreeform = typeof question.allowFreeform === 'boolean'
        ? question.allowFreeform
        : typeof question.allow_freeform === 'boolean'
          ? question.allow_freeform
          : !options || options.length === 0;

      return {
        ...(typeof question.header === 'string' ? { header: question.header } : {}),
        question: typeof question.question === 'string' ? question.question : String(question.prompt ?? ''),
        ...(options?.length ? { options } : {}),
        allowFreeform,
        ...(typeof question.placeholder === 'string' ? { placeholder: question.placeholder } : {}),
        ...(typeof question.multiSelect === 'boolean' ? { multiSelect: question.multiSelect } : {}),
      };
    })
    .filter((question: { question: string }) => question.question.trim().length > 0);
}

export function mapClaudeEffort(thinking: 'low' | 'medium' | 'high' | 'xhigh'): 'low' | 'medium' | 'high' {
  if (thinking === 'xhigh') return 'high';
  return thinking;
}
