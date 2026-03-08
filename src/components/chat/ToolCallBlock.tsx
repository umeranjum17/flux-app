import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';

interface ToolCallBlockProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  content: string;
  isRunning?: boolean;
  resultContent?: string;
  resultIsError?: boolean;
  isComplete?: boolean;
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

function getToolDescription(toolName: string, toolInput?: Record<string, unknown>): string {
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
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if ((name.includes('read') || name.includes('write') || name.includes('edit')) && (toolInput.file_path || toolInput.path)) {
    return String(toolInput.file_path || toolInput.path);
  }
  if (name.includes('grep') && toolInput.pattern) {
    return `/${toolInput.pattern}/`;
  }
  if (name.includes('glob') && toolInput.pattern) {
    return String(toolInput.pattern);
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

export function ToolCallBlock({
  toolName,
  toolInput,
  toolCallId,
  content,
  isRunning,
  resultContent,
  resultIsError,
  isComplete,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { Icon, color } = getToolIcon(toolName);
  const description = getToolDescription(toolName, toolInput);
  const todoItems = useMemo(() => parseTodoItems(toolName, toolInput), [toolInput, toolName]);
  const questionItems = useMemo(() => parseQuestionItems(toolName, toolInput), [toolInput, toolName]);
  const isSemanticTodo = todoItems.length > 0;
  const isSemanticQuestion = questionItems.length > 0;

  const diffStats = useMemo(() => {
    if (!isFileEditTool(toolName) || !resultContent) return null;
    return countDiffStats(resultContent);
  }, [toolName, resultContent]);

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
    <div className="bg-bg-elevated rounded-lg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-sm py-2.5 px-3"
      >
        {statusIcon}
        <span className="text-text-secondary truncate flex-1 text-[13px]">
          {description}
        </span>
        {diffStats && (
          <span className="flex items-center gap-1 shrink-0">
            <span className="bg-success/15 text-success text-xs font-mono px-1.5 py-0.5 rounded">
              +{diffStats.added}
            </span>
            <span className="text-text-tertiary text-xs">&middot;</span>
            <span className="bg-error/15 text-error text-xs font-mono px-1.5 py-0.5 rounded">
              -{diffStats.removed}
            </span>
          </span>
        )}
        {resultContent && (
          <Download size={13} className="text-text-tertiary shrink-0 hover:text-text-secondary" />
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
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

      {expanded && !isSemanticTodo && !isSemanticQuestion && (
        <div className="px-3 pb-3 space-y-2">
          {toolInput && (
            <pre className="bg-bg-primary rounded-md p-3 text-[13px] font-mono text-text-secondary overflow-x-auto">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          )}
          {resultContent && (
            <div className={`rounded-md p-3 ${resultIsError ? 'bg-error/5' : 'bg-bg-primary'}`}>
              <pre className="text-[13px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">
                <code>{resultContent}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
