import React, { Component, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  SquareTerminal,
  FileText,
  FilePen,
  FileSearch2,
  FolderSearch,
  Wrench,
  ListTodo,
  CircleHelp,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { BashPanel, ReadPanel, EditDiffPanel, SearchPanel, GlobPanel, GenericPanel } from './ToolPanels';
import { formatToolCallLabel, isFileEditToolName, type ToolCallImportance } from '../../lib/tool-call-display';

const EXPAND_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
};

class ToolContentErrorBoundary extends Component<
  { children: React.ReactNode; fallbackContent?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="pl-6 pr-2 pb-2">
          <div className="rounded-md border border-error/20 bg-error/5 p-2">
            <div className="flex items-center gap-1.5 text-[13px] text-error font-medium">
              <AlertTriangle size={12} />
              Failed to render output
            </div>
            {this.props.fallbackContent && (
              <pre className="text-[12px] font-mono text-text-tertiary whitespace-pre-wrap max-h-24 overflow-y-auto mt-1">
                {this.props.fallbackContent.slice(0, 500)}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ToolCallBlockProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  content: string;
  isRunning?: boolean;
  resultContent?: string;
  resultIsError?: boolean;
  isComplete?: boolean;
  diff?: string;
  filePath?: string;
  forceExpanded?: boolean;
  importance?: ToolCallImportance;
}

interface TodoItem {
  content: string;
  status: 'completed' | 'in_progress' | 'pending';
  activeForm?: string;
}

interface QuestionItem {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes('todo')) return { Icon: ListTodo, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('question')) return { Icon: CircleHelp, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('bash') || name.includes('command') || name.includes('shell'))
    return { Icon: SquareTerminal, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('read') || name.includes('view'))
    return { Icon: FileText, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('write') || name.includes('edit') || name.includes('patch'))
    return { Icon: FilePen, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('grep') || name.includes('search'))
    return { Icon: FileSearch2, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('glob') || name.includes('find'))
    return { Icon: FolderSearch, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  if (name.includes('agent'))
    return { Icon: Sparkles, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
  return { Icon: Wrench, color: 'text-text-tertiary', bg: 'bg-bg-hover/50' };
}

function getToolDescription(toolName: string, toolInput?: Record<string, unknown>, resultContent?: string): string {
  if (!toolInput) return '';
  const name = toolName.toLowerCase();
  const todoItems = parseTodoItems(toolName, toolInput);
  if (todoItems.length > 0) {
    const completed = todoItems.filter((item) => item.status === 'completed').length;
    return `${completed}/${todoItems.length} completed`;
  }
  const questionItems = parseQuestionItems(toolName, toolInput);
  if (questionItems.length > 0) {
    return questionItems[0].question;
  }

  if (name.includes('bash') && toolInput.command) {
    const cmd = String(toolInput.command);
    const trimmed = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    const exitCode = parseExitCode(resultContent);
    return typeof exitCode === 'number' ? `${trimmed}  exit ${exitCode}` : trimmed;
  }
  if (name.includes('agent') && toolInput.prompt) {
    const prompt = String(toolInput.prompt);
    return prompt.length > 80 ? prompt.slice(0, 80) + '...' : prompt;
  }
  if (name.includes('agent') && toolInput.description) {
    return String(toolInput.description);
  }
  if ((name.includes('read') || name.includes('write') || name.includes('edit')) && (toolInput.file_path || toolInput.path)) {
    const fp = String(toolInput.file_path || toolInput.path);
    // Show just the filename for brevity in the header
    const shortPath = fp.split('/').slice(-2).join('/');
    if (name.includes('read') && resultContent) {
      const lineCount = resultContent.split('\n').length;
      return `${shortPath} (${lineCount} lines)`;
    }
    return shortPath;
  }
  if (name.includes('grep') && toolInput.pattern) {
    const summary = summarizeGrepResult(resultContent);
    return summary
      ? `/${toolInput.pattern}/ · ${summary.matches} matches in ${summary.files} files`
      : `/${toolInput.pattern}/`;
  }
  if (name.includes('glob') && toolInput.pattern) {
    const count = extractGlobPaths(resultContent).length;
    return count > 0 ? `${String(toolInput.pattern)} · ${count} files` : String(toolInput.pattern);
  }
  // Generic fallback: show first meaningful string field for unrecognized tools
  // (e.g. Copilot's report_intent, task, and other provider-specific tool names)
  for (const field of ['description', 'title', 'name', 'intention', 'intent', 'summary', 'message']) {
    if (typeof toolInput[field] === 'string' && (toolInput[field] as string).trim()) {
      const text = (toolInput[field] as string).trim();
      return text.length > 80 ? text.slice(0, 80) + '...' : text;
    }
  }
  return '';
}

function countDiffStats(content: string): { added: number; removed: number } | null {
  const lines = content.split('\n');
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

/**
 * Synthesize a unified diff string from Edit/Write tool input when no
 * explicit diff is provided. Edit tools have old_string/new_string,
 * Write tools have content (new file).
 */
function synthesizeDiffFromToolInput(
  toolName: string,
  toolInput?: Record<string, unknown>,
): string | undefined {
  if (!toolInput) return undefined;
  const name = toolName.toLowerCase();
  const filePath = (toolInput.file_path ?? toolInput.path ?? toolInput.filePath) as
    | string
    | undefined;
  const shortPath = filePath ?? 'file';

  if (name.includes('edit') || name.includes('patch')) {
    const oldStr = toolInput.old_string as string | undefined;
    const newStr = toolInput.new_string as string | undefined;
    if (oldStr != null && newStr != null) {
      const oldLines = oldStr.split('\n');
      const newLines = newStr.split('\n');
      const header = `--- a/${shortPath}\n+++ b/${shortPath}`;
      const hunk = `@@ -1,${oldLines.length} +1,${newLines.length} @@`;
      const removed = oldLines.map((l) => `-${l}`);
      const added = newLines.map((l) => `+${l}`);
      return `${header}\n${hunk}\n${removed.join('\n')}\n${added.join('\n')}`;
    }
  }

  if (name.includes('write')) {
    const content = toolInput.content as string | undefined;
    if (content) {
      const lines = content.split('\n');
      // Cap at 200 lines to keep the UI responsive for large files
      const capped = lines.length > 200 ? lines.slice(0, 200) : lines;
      const header = `--- /dev/null\n+++ b/${shortPath}`;
      const hunk = `@@ -0,0 +1,${lines.length} @@`;
      const added = capped.map((l) => `+${l}`);
      const suffix =
        lines.length > 200 ? `\n+... (${lines.length - 200} more lines)` : '';
      return `${header}\n${hunk}\n${added.join('\n')}${suffix}`;
    }
  }

  return undefined;
}

function parseExitCode(resultContent?: string): number | null {
  if (!resultContent) return null;
  const match = resultContent.match(/\bexit(?:\s+code)?[: ]+(-?\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function summarizeGrepResult(resultContent?: string): { matches: number; files: number } | null {
  if (!resultContent) return null;
  const counts = extractGrepMatches(resultContent);
  if (counts.length === 0) return null;
  return {
    matches: counts.reduce((total, item) => total + item.count, 0),
    files: counts.length,
  };
}

function extractGrepMatches(resultContent?: string): Array<{ file: string; count: number }> {
  if (!resultContent) return [];
  const counts = new Map<string, number>();
  for (const line of resultContent.split('\n')) {
    const match = line.match(/^(.+?):\d+:/);
    if (!match) continue;
    const file = match[1];
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([file, count]) => ({ file, count }));
}

function extractGlobPaths(resultContent?: string): string[] {
  if (!resultContent) return [];
  try {
    const parsed = JSON.parse(resultContent);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Fall through to line parsing.
  }
  return resultContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function ToolCallBlock({
  toolName,
  toolInput,
  toolCallId,
  content,
  isRunning,
  resultContent,
  resultIsError,
  isComplete,
  diff,
  filePath,
  forceExpanded,
  importance = 'routine',
}: ToolCallBlockProps) {
  const isEdit = isFileEditToolName(toolName);
  const resolvedFilePath = filePath ?? (toolInput?.file_path as string | undefined) ?? (toolInput?.path as string | undefined);
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expanded || (forceExpanded ?? false);
  const { Icon, color, bg } = getToolIcon(toolName);
  const description = getToolDescription(toolName, toolInput, resultContent);
  const todoItems = useMemo(() => parseTodoItems(toolName, toolInput), [toolInput, toolName]);
  const questionItems = useMemo(() => parseQuestionItems(toolName, toolInput), [toolInput, toolName]);
  const isSemanticTodo = todoItems.length > 0;
  const isSemanticQuestion = questionItems.length > 0;
  const shouldShowSemanticBody = isSemanticTodo || isSemanticQuestion;

  const resolvedDiff = useMemo(
    () => diff ?? synthesizeDiffFromToolInput(toolName, toolInput),
    [diff, toolName, toolInput],
  );

  const diffStats = useMemo(() => {
    if (!isFileEditToolName(toolName)) return null;
    const diffSource = resolvedDiff ?? resultContent;
    if (!diffSource) return null;
    return countDiffStats(diffSource);
  }, [toolName, resolvedDiff, resultContent]);

  useEffect(() => {
    if (importance === 'important' && resultIsError) {
      setExpanded(true);
    }
  }, [importance, resultIsError]);

  const statusIcon = useMemo(() => {
    if (isRunning && !isComplete) {
      return { icon: <Loader2 size={11} className="text-text-tertiary animate-spin shrink-0" />, badgeBg: 'bg-bg-hover/50' };
    }
    if (isComplete && resultIsError) {
      return { icon: <XCircle size={11} className="text-error/70 shrink-0" />, badgeBg: 'bg-error/5' };
    }
    if (isComplete) {
      return { icon: <CheckCircle size={11} className="text-text-tertiary/70 shrink-0" />, badgeBg: 'bg-bg-hover/50' };
    }
    return { icon: <Icon size={11} className={`${color} shrink-0`} />, badgeBg: bg };
  }, [isRunning, isComplete, resultIsError, Icon, color, bg]);

  const hasExpandableContent = !!resultContent || !!resolvedDiff || shouldShowSemanticBody;
  const rowTone = resultIsError
    ? 'border border-error/20 bg-error/5'
    : importance === 'important'
      ? 'tool-call-row-important border border-border/20 bg-bg-secondary/20'
      : '';
  const chevronTone = importance === 'important'
    ? 'ml-auto shrink-0 text-text-tertiary/70'
    : 'ml-auto shrink-0 text-text-tertiary/50 opacity-0 transition-opacity group-hover:opacity-100';

  return (
    <div
      className={`tool-call-row group rounded-md ${rowTone}`}
      data-tool-call-id={toolCallId}
      {...(isEdit && resolvedFilePath ? { 'data-file-edit': resolvedFilePath } : {})}
    >
      <button
        onClick={() => hasExpandableContent && setExpanded(!isExpanded)}
        className="flex w-full items-center gap-1.5 py-0.5 text-left rounded-md hover:bg-bg-hover/40 transition-colors"
      >
        <span className={`inline-flex shrink-0 items-center justify-center rounded-full p-0.5 ${statusIcon.badgeBg}`}>
          {statusIcon.icon}
        </span>
        <span className="text-[11px] font-medium text-text-secondary/80">
          {formatToolCallLabel(toolName)}
        </span>
        {description ? (
          <span className="text-[11px] text-text-tertiary/60 truncate min-w-0 flex-1">
            {description}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {diffStats && (
          <span className="ml-auto flex items-center gap-1 shrink-0 text-[10px] font-mono text-text-tertiary/60">
            <span>+{diffStats.added}</span>
            <span>-{diffStats.removed}</span>
          </span>
        )}
        {hasExpandableContent && (
          <span className={chevronTone}>
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && hasExpandableContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={EXPAND_TRANSITION}
            className="overflow-hidden"
          >
            <div className="pl-5 pr-1 pt-1 pb-2">
              {shouldShowSemanticBody && (
                <>
                  {isSemanticTodo && <TodoPreview items={todoItems} expanded={isExpanded} />}
                  {isSemanticQuestion && <QuestionPreview questions={questionItems} />}
                </>
              )}

              {!shouldShowSemanticBody && (
                <ToolContentErrorBoundary fallbackContent={resultContent ?? resolvedDiff}>
                  <ExpandedToolContent
                    toolName={toolName}
                    toolInput={toolInput}
                    resultContent={resultContent}
                    resultIsError={resultIsError}
                    diff={resolvedDiff}
                    filePath={resolvedFilePath}
                  />
                </ToolContentErrorBoundary>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ExpandedToolContent({
  toolName,
  toolInput,
  resultContent,
  resultIsError,
  diff,
  filePath,
}: {
  toolName: string;
  toolInput?: Record<string, unknown>;
  resultContent?: string;
  resultIsError?: boolean;
  diff?: string;
  filePath?: string;
}) {
  const name = toolName.toLowerCase();

  if (name.includes('edit') || name.includes('write') || name.includes('patch')) {
    return <EditDiffPanel diff={diff} filePath={filePath} />;
  }
  if (name.includes('bash') || name.includes('command') || name.includes('shell')) {
    return <BashPanel toolInput={toolInput} resultContent={resultContent} resultIsError={resultIsError} />;
  }
  if (name.includes('read') || name.includes('view')) {
    return <ReadPanel toolInput={toolInput} resultContent={resultContent} />;
  }
  if (name.includes('grep') || name.includes('search')) {
    return <SearchPanel toolInput={toolInput} resultContent={resultContent} />;
  }
  if (name.includes('glob') || name.includes('find')) {
    return <GlobPanel toolInput={toolInput} resultContent={resultContent} />;
  }
  return <GenericPanel toolInput={toolInput} resultContent={resultContent} resultIsError={resultIsError} />;
}

function TodoPreview({ items, expanded }: { items: TodoItem[]; expanded: boolean }) {
  const visibleItems = expanded ? items : items.slice(0, 4);

  return (
    <div className="space-y-1.5">
      {visibleItems.map((item, index) => (
        <div key={`${item.content}-${index}`} className="flex items-start gap-2 text-[12px]">
          <span className="mt-0.5 shrink-0 text-text-tertiary">
            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◌' : '○'}
          </span>
          <div className="min-w-0">
            <div className={item.status === 'completed' ? 'text-text-tertiary line-through' : 'text-text-primary'}>
              {item.content}
            </div>
            {item.activeForm && item.activeForm !== item.content && item.status === 'in_progress' && (
              <div className="text-[12px] text-text-tertiary">{item.activeForm}</div>
            )}
          </div>
        </div>
      ))}
      {!expanded && items.length > visibleItems.length && (
        <div className="text-[12px] text-text-tertiary pl-5">
          +{items.length - visibleItems.length} more
        </div>
      )}
    </div>
  );
}

function QuestionPreview({ questions }: { questions: QuestionItem[] }) {
  return (
    <div className="space-y-2">
      {questions.map((question, index) => (
        <div key={`${question.question}-${index}`} className="space-y-1">
          {question.header && (
            <div className="text-[12px] font-semibold uppercase tracking-wider text-text-tertiary">
              {question.header}
            </div>
          )}
          <div className="text-[12px] text-text-primary">{question.question}</div>
          {question.options.length > 0 && (
            <div className="space-y-1 pl-2">
              {question.options.map((option) => (
                <div key={option.label} className="text-[12px] text-text-secondary">
                  {option.label}
                  {option.description && (
                    <span className="text-text-tertiary ml-1">— {option.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function parseTodoItems(toolName: string, toolInput?: Record<string, unknown>): TodoItem[] {
  if (!toolInput) return [];
  const lowerToolName = toolName.toLowerCase();
  const supportsTodoPayload = lowerToolName.includes('todo') || lowerToolName === 'update_plan';
  if (!supportsTodoPayload) return [];

  const rawItems = Array.isArray(toolInput.todos)
    ? toolInput.todos
    : Array.isArray(toolInput.plan)
      ? toolInput.plan
      : [];

  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      content: typeof item.content === 'string'
        ? item.content
        : typeof item.step === 'string'
          ? item.step
        : typeof item.title === 'string'
          ? item.title
          : String(item.text ?? ''),
      status: toTodoStatus(item.status),
      ...(typeof item.activeForm === 'string' ? { activeForm: item.activeForm } : {}),
    }))
    .filter((item) => item.content.trim().length > 0);
}

function parseQuestionItems(toolName: string, toolInput?: Record<string, unknown>): QuestionItem[] {
  if (!toolInput) return [];
  const lowerName = toolName.toLowerCase();
  if (!lowerName.includes('question') && !lowerName.includes('request_user_input')) return [];
  if (!Array.isArray(toolInput.questions)) return [];

  return toolInput.questions
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      ...(typeof item.header === 'string' ? { header: item.header } : {}),
      question: typeof item.question === 'string' ? item.question : String(item.prompt ?? ''),
      options: Array.isArray(item.options)
        ? item.options
          .filter((option): option is Record<string, unknown> => !!option && typeof option === 'object' && !Array.isArray(option))
          .map((option) => ({
            label: typeof option.label === 'string' ? option.label : String(option.value ?? ''),
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
          }))
          .filter((option) => option.label.trim().length > 0)
        : [],
    }))
    .filter((item) => item.question.trim().length > 0);
}

function toTodoStatus(value: unknown): TodoItem['status'] {
  if (value === 'completed' || value === 'in_progress' || value === 'pending') {
    return value;
  }
  return 'pending';
}
