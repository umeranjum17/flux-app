import React, { Component, useState, useMemo } from 'react';
import {
  Terminal,
  FileText,
  FilePen,
  Search,
  Wrench,
  ListTodo,
  CircleHelp,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle,
  XCircle,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { BashPanel, ReadPanel, EditDiffPanel, SearchPanel, GlobPanel, GenericPanel } from './ToolPanels';

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
        <div className="px-3 pb-3">
          <div className="rounded-md border border-error/20 bg-error/5 p-3">
            <div className="flex items-center gap-2 text-xs text-error font-medium mb-1">
              <AlertTriangle size={12} />
              Failed to render tool output
            </div>
            {this.props.fallbackContent && (
              <pre className="text-xs font-mono text-text-tertiary whitespace-pre-wrap max-h-32 overflow-y-auto mt-2">
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

function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes('todo')) {
    return { Icon: ListTodo, color: 'text-info' };
  }
  if (name.includes('question')) {
    return { Icon: CircleHelp, color: 'text-info' };
  }
  if (name.includes('bash') || name.includes('command') || name.includes('shell')) {
    return { Icon: Terminal, color: 'text-warning' };
  }
  if (name.includes('read') || name.includes('view')) {
    return { Icon: FileText, color: 'text-info' };
  }
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) {
    return { Icon: FilePen, color: 'text-info' };
  }
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('find')) {
    return { Icon: Search, color: 'text-success' };
  }
  return { Icon: Wrench, color: 'text-text-secondary' };
}

function getToolDescription(toolName: string, toolInput?: Record<string, unknown>, resultContent?: string): string {
  if (!toolInput) return toolName;
  const name = toolName.toLowerCase();
  const todoItems = parseTodoItems(toolName, toolInput);
  if (todoItems.length > 0) {
    const completed = todoItems.filter((item) => item.status === 'completed').length;
    return `${completed} out of ${todoItems.length} tasks completed`;
  }
  const questionItems = parseQuestionItems(toolName, toolInput);
  if (questionItems.length > 0) {
    return questionItems[0].question;
  }

  if (name.includes('bash') && toolInput.command) {
    const cmd = String(toolInput.command);
    const trimmed = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
    const exitCode = parseExitCode(resultContent);
    return typeof exitCode === 'number' ? `$ ${trimmed} · exit ${exitCode}` : `$ ${trimmed}`;
  }
  if ((name.includes('read') || name.includes('write') || name.includes('edit')) && (toolInput.file_path || toolInput.path)) {
    const filePath = String(toolInput.file_path || toolInput.path);
    if (name.includes('read') && resultContent) {
      const lineCount = resultContent.split('\n').length;
      return `${filePath} (${lineCount} lines)`;
    }
    return filePath;
  }
  if (name.includes('grep') && toolInput.pattern) {
    const summary = summarizeGrepResult(resultContent);
    return summary
      ? `/${toolInput.pattern}/ · ${summary.matches} matches in ${summary.files} files`
      : `/${toolInput.pattern}/`;
  }
  if (name.includes('glob') && toolInput.pattern) {
    const count = extractGlobPaths(resultContent).length;
    return count > 0 ? `${String(toolInput.pattern)} · ${count} files found` : String(toolInput.pattern);
  }
  return toolName;
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

function isFileEditTool(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name.includes('edit') || name.includes('write') || name.includes('patch');
}

const MAX_RESULT_LINES = 3;

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

function getPreviewLines(resultContent: string, maxLines: number): string[] {
  return resultContent.split('\n').slice(0, maxLines);
}

function ToolResultPreview({
  toolName,
  resultContent,
}: {
  toolName: string;
  resultContent: string;
}) {
  const lowerName = toolName.toLowerCase();

  if (lowerName.includes('read')) {
    const lines = resultContent.split('\n');
    const preview = lines.slice(0, MAX_RESULT_LINES).join('\n');
    const remaining = Math.max(0, lines.length - MAX_RESULT_LINES);
    return (
      <div className="px-3 pb-2">
        <div className="max-h-28 overflow-hidden rounded-md bg-bg-primary/70 px-3 py-2">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">{preview}</pre>
        </div>
        {remaining > 0 && (
          <div className="mt-1 text-[11px] text-text-tertiary">({remaining} more lines)</div>
        )}
      </div>
    );
  }

  if (lowerName.includes('grep')) {
    const matches = extractGrepMatches(resultContent).slice(0, 5);
    if (matches.length === 0) return null;
    return (
      <div className="px-3 pb-2">
        <div className="space-y-1 rounded-md bg-bg-primary/50 px-3 py-2">
          {matches.map((match) => (
            <div key={match.file} className="flex items-center justify-between gap-3 text-xs font-mono text-text-secondary">
              <span className="truncate">{match.file}</span>
              <span className="shrink-0 text-text-tertiary">{match.count} match{match.count === 1 ? '' : 'es'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (lowerName.includes('glob')) {
    const paths = extractGlobPaths(resultContent).slice(0, 8);
    if (paths.length === 0) return null;
    return (
      <div className="px-3 pb-2">
        <div className="space-y-1 rounded-md bg-bg-primary/50 px-3 py-2">
          {paths.map((filePath) => (
            <div key={filePath} className="truncate text-xs font-mono text-text-secondary">{filePath}</div>
          ))}
        </div>
      </div>
    );
  }

  if (lowerName.includes('bash') || lowerName.includes('command') || lowerName.includes('shell')) {
    const lines = getPreviewLines(resultContent, 3).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;
    return (
      <div className="px-3 pb-2">
        <div className="max-h-24 overflow-hidden rounded-md bg-black/30 px-3 py-2">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">{lines.join('\n')}</pre>
        </div>
      </div>
    );
  }

  return null;
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
}: ToolCallBlockProps) {
  const isEdit = isFileEditTool(toolName);
  const resolvedFilePath = filePath ?? (toolInput?.file_path as string | undefined) ?? (toolInput?.path as string | undefined);
  const [expanded, setExpanded] = useState(isEdit);
  const { Icon, color } = getToolIcon(toolName);
  const description = getToolDescription(toolName, toolInput, resultContent);
  const todoItems = useMemo(() => parseTodoItems(toolName, toolInput), [toolInput, toolName]);
  const questionItems = useMemo(() => parseQuestionItems(toolName, toolInput), [toolInput, toolName]);
  const isSemanticTodo = todoItems.length > 0;
  const isSemanticQuestion = questionItems.length > 0;

  const diffStats = useMemo(() => {
    if (!isFileEditTool(toolName)) return null;
    const diffSource = diff ?? resultContent;
    if (!diffSource) return null;
    return countDiffStats(diffSource);
  }, [toolName, diff, resultContent]);

  const statusIcon = useMemo(() => {
    if (isRunning && !isComplete) {
      return <Loader2 size={14} className={`${color} animate-spin shrink-0`} />;
    }
    if (isComplete) {
      return resultIsError
        ? <XCircle size={14} className="text-error shrink-0" />
        : <CheckCircle size={14} className="text-success shrink-0" />;
    }
    return <Icon size={14} className={`${color} shrink-0`} />;
  }, [isRunning, isComplete, resultIsError, Icon, color]);

  return (
    <div className="bg-bg-surface/80 rounded-lg border border-border-subtle overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full text-left py-2.5 px-3 hover:bg-bg-hover/30 transition-colors"
      >
        {statusIcon}
        <span className="text-text-secondary truncate flex-1 text-[12px]">
          {description}
        </span>
        {diffStats && (
          <span className="flex items-center gap-1 shrink-0">
            <span className="bg-success/12 text-success text-[11px] font-mono px-1.5 py-0.5 rounded">
              +{diffStats.added}
            </span>
            <span className="bg-error/12 text-error text-[11px] font-mono px-1.5 py-0.5 rounded">
              -{diffStats.removed}
            </span>
          </span>
        )}
        {resultContent && (
          <Download size={12} className="text-text-tertiary/50 shrink-0" />
        )}
        {expanded ? (
          <ChevronDown size={13} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-text-tertiary shrink-0" />
        )}
      </button>

      {(isSemanticTodo || isSemanticQuestion) && (
        <div className="px-3 pb-3">
          {isSemanticTodo && (
            <TodoPreview items={todoItems} expanded={expanded} />
          )}
          {isSemanticQuestion && (
            <QuestionPreview questions={questionItems} />
          )}
        </div>
      )}

      {!expanded && !isEdit && resultContent && !isSemanticTodo && !isSemanticQuestion && (
        <ToolContentErrorBoundary fallbackContent={resultContent}>
          <ToolResultPreview toolName={toolName} resultContent={resultContent} />
        </ToolContentErrorBoundary>
      )}

      {expanded && !isSemanticTodo && !isSemanticQuestion && (
        <ToolContentErrorBoundary fallbackContent={resultContent ?? diff}>
          <ExpandedToolContent
            toolName={toolName}
            toolInput={toolInput}
            resultContent={resultContent}
            resultIsError={resultIsError}
            diff={diff}
            filePath={resolvedFilePath}
          />
        </ToolContentErrorBoundary>
      )}
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
    <div className="space-y-2">
      {visibleItems.map((item, index) => (
        <div key={`${item.content}-${index}`} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 shrink-0 text-text-tertiary">
            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◌' : '○'}
          </span>
          <div className="min-w-0">
            <div className={item.status === 'completed' ? 'text-text-tertiary line-through' : 'text-text-primary'}>
              {item.content}
            </div>
            {item.activeForm && item.activeForm !== item.content && item.status === 'in_progress' && (
              <div className="text-xs text-text-tertiary">{item.activeForm}</div>
            )}
          </div>
        </div>
      ))}
      {!expanded && items.length > visibleItems.length && (
        <div className="text-xs text-text-tertiary">
          {items.length - visibleItems.length} more task{items.length - visibleItems.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function QuestionPreview({ questions }: { questions: QuestionItem[] }) {
  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <div key={`${question.question}-${index}`} className="space-y-2">
          {question.header && (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              {question.header}
            </div>
          )}
          <div className="text-sm text-text-primary">{question.question}</div>
          {question.options.length > 0 && (
            <div className="space-y-1.5">
              {question.options.map((option) => (
                <div key={option.label} className="rounded-md bg-bg-primary/70 px-3 py-2">
                  <div className="text-sm text-text-primary">{option.label}</div>
                  {option.description && (
                    <div className="mt-1 text-xs text-text-tertiary">{option.description}</div>
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
  if (!toolInput || !toolName.toLowerCase().includes('todo')) return [];
  if (!Array.isArray(toolInput.todos)) return [];

  return toolInput.todos
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      content: typeof item.content === 'string'
        ? item.content
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
