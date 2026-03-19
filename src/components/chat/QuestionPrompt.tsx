import React, { useMemo, useState } from 'react';
import { CheckCircle2, CircleHelp, SendHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import type { QuestionField } from '../../lib/types';

interface QuestionPromptProps {
  taskId: string;
  requestId: string;
  prompt: string;
  questions: QuestionField[];
  allowFreeform?: boolean;
  placeholder?: string;
}

export function QuestionPrompt({
  taskId,
  requestId,
  prompt,
  questions,
  allowFreeform = true,
  placeholder,
}: QuestionPromptProps) {
  const pendingQuestion = useChatStore((s) => s.tasks.get(taskId)?.pendingQuestion);
  const isActive = pendingQuestion?.requestId === requestId;

  const [selectedOptions, setSelectedOptions] = useState<Record<number, string[]>>({});
  const [freeformAnswers, setFreeformAnswers] = useState<Record<number, string>>({});
  const isSimpleSingleChoice = questions.length === 1
    && !questions[0]?.multiSelect
    && !!questions[0]?.options?.length
    && !questions[0]?.allowFreeform;

  const canSubmit = useMemo(() => (
    questions.some((question, index) => {
      const selected = selectedOptions[index] ?? [];
      const freeform = freeformAnswers[index]?.trim();
      if (selected.length > 0) return true;
      if ((question.allowFreeform ?? allowFreeform) && freeform) return true;
      return false;
    })
  ), [allowFreeform, freeformAnswers, questions, selectedOptions]);

  const submitResponse = async (response: string) => {
    if (!response.trim()) return;
    const previousQuestion = useChatStore.getState().tasks.get(taskId)?.pendingQuestion ?? null;
    useChatStore.getState().setPendingQuestion(taskId, null);
    try {
      await window.api.invoke('task:answer-question', { taskId, requestId, response });
    } catch (err) {
      useChatStore.getState().setPendingQuestion(taskId, previousQuestion);
      const message = err instanceof Error ? err.message : 'Failed to answer question';
      toast.error(message);
    }
  };

  const handleSingleChoice = (label: string) => {
    void submitResponse(label);
  };

  const handleToggleOption = (questionIndex: number, label: string, multiSelect: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[questionIndex] ?? [];
      if (!multiSelect) {
        return { ...prev, [questionIndex]: [label] };
      }

      const next = current.includes(label)
        ? current.filter((value) => value !== label)
        : [...current, label];
      return { ...prev, [questionIndex]: next };
    });
  };

  const handleSubmit = () => {
    const parts = questions.map((question, index) => {
      const selected = selectedOptions[index] ?? [];
      const freeform = freeformAnswers[index]?.trim();
      const answer = selected.length > 0
        ? selected.join(', ')
        : freeform ?? '';

      if (!answer) return null;
      return `"${question.question}" = ${answer}`;
    }).filter(Boolean);

    if (parts.length === 0) return;
    void submitResponse(parts.join('\n'));
  };

  const displayQuestions = questions.length > 0 ? questions : [{
    question: prompt,
    allowFreeform,
    placeholder,
  }];

  // Already answered — show compact read-only view
  if (!isActive) {
    return (
      <div className="rounded-lg border border-border/50 bg-bg-surface/50 px-4 py-3">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-secondary">{prompt}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-4">
      <div className="flex items-start gap-3">
        <CircleHelp size={18} className="mt-0.5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-text-primary">Input requested</h4>
          <p className="mt-1 text-sm text-text-secondary">{prompt}</p>

          <div className="mt-3 space-y-4">
            {displayQuestions.map((question, index) => {
              const selected = selectedOptions[index] ?? [];
              const supportsFreeform = question.allowFreeform ?? allowFreeform;
              return (
                <div key={`${question.header ?? 'question'}-${index}`} className="space-y-2">
                  {question.header && (
                    <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
                      {question.header}
                    </div>
                  )}
                  <div className="text-sm text-text-primary">{question.question}</div>

                  {question.options?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {question.options.map((option) => {
                        const active = selected.includes(option.label);
                        return (
                          <button
                            key={option.value ?? option.label}
                            type="button"
                            onClick={() => {
                              if (isSimpleSingleChoice) {
                                handleSingleChoice(option.value ?? option.label);
                                return;
                              }
                              handleToggleOption(index, option.value ?? option.label, question.multiSelect ?? false);
                            }}
                            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                              active
                                ? 'border-info/60 bg-info/10 text-text-primary'
                                : 'border-border bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                            }`}
                          >
                            <div>{option.label}</div>
                            {option.description && (
                              <div className="mt-1 max-w-xl text-xs text-text-tertiary">{option.description}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {supportsFreeform && (
                    <textarea
                      value={freeformAnswers[index] ?? ''}
                      onChange={(event) => setFreeformAnswers((prev) => ({
                        ...prev,
                        [index]: event.target.value,
                      }))}
                      placeholder={question.placeholder ?? placeholder ?? 'Type your answer'}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-info/50"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {!isSimpleSingleChoice && (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendHorizontal size={14} />
                Submit answer
              </button>
              <span className="text-xs text-text-tertiary">
                You can also answer from the composer below.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
