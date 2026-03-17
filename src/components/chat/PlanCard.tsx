import React, { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ClipboardList,
  Copy,
  Check,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { markdownComponents } from './MarkdownComponents';
import type { Task, PlanSection, PlanStep } from '../../lib/types';
import { getLatestPlanText } from '../../lib/plan';

/** Fallback: parse markdown headings into sections when no FLUX_PLAN data is available */
function parsePlanSections(text: string): PlanSection[] {
  const sections: PlanSection[] = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headingMatch) {
      if (currentTitle || currentContent.length > 0) {
        sections.push({
          title: currentTitle || 'Overview',
          content: currentContent.join('\n').trim(),
        });
      }
      currentTitle = headingMatch[1].replace(/^#+\s*/, '');
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentTitle || currentContent.length > 0) {
    sections.push({
      title: currentTitle || 'Overview',
      content: currentContent.join('\n').trim(),
    });
  }

  return sections;
}

/** Fallback: extract numbered steps from markdown when no FLUX_PLAN data */
function extractStepsFromMarkdown(content: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = content.split('\n');
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      if (currentTitle) {
        steps.push({ title: currentTitle, details: currentBody.join('\n').trim() });
      }
      const raw = match[1];
      const boldMatch = raw.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.*)/);
      if (boldMatch) {
        currentTitle = boldMatch[1].trim();
        currentBody = boldMatch[2].trim() ? [boldMatch[2].trim()] : [];
      } else {
        currentTitle = raw.length > 80 ? raw.slice(0, 80).replace(/\s+\S*$/, '').trim() : raw;
        currentBody = raw.length > 80 ? [raw.slice(currentTitle.length).trim()] : [];
      }
    } else if (currentTitle) {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    steps.push({ title: currentTitle, details: currentBody.join('\n').trim() });
  }

  return steps;
}

/** Extract file paths from step details */
function extractFilePaths(text: string): string[] {
  const matches = text.match(/`([^`]+\.[a-zA-Z]{1,6}(?::\d+)?)`/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/`/g, '')))].slice(0, 3);
}

interface PlanCardProps {
  task: Task;
  isStreaming?: boolean;
}

export function PlanCard({ task, isStreaming }: PlanCardProps) {
  const [copied, setCopied] = useState(false);

  const setTaskStatus = useChatStore((s) => s.setTaskStatus);
  const setTaskMode = useChatStore((s) => s.setTaskMode);

  const planText = useMemo(() => getLatestPlanText(task.messages), [task.messages]);

  // Use structured FLUX_PLAN data when available, fall back to markdown parsing
  const sections: PlanSection[] = useMemo(() => {
    if (task.planData) {
      const result: PlanSection[] = [];
      if (task.planData.summary) {
        result.push({ title: 'Summary', content: task.planData.summary });
      }
      result.push(...task.planData.sections);
      if (task.planData.steps.length > 0) {
        result.push({ title: 'Steps', content: '' });
      }
      return result;
    }
    return parsePlanSections(planText);
  }, [task.planData, planText]);

  const steps: PlanStep[] = useMemo(() => {
    if (task.planData) return task.planData.steps;
    const stepsSection = sections.find((s) => s.title.toLowerCase().includes('step'));
    return stepsSection ? extractStepsFromMarkdown(stepsSection.content) : [];
  }, [task.planData, sections]);

  // Get summary and considerations from sections
  const summary = useMemo(() => {
    const s = sections.find((sec) => sec.title.toLowerCase().includes('summary') || sec.title.toLowerCase().includes('overview'));
    return s?.content || '';
  }, [sections]);

  const considerations = useMemo(() => {
    const s = sections.find((sec) =>
      sec.title.toLowerCase().includes('consideration') ||
      sec.title.toLowerCase().includes('risk') ||
      sec.title.toLowerCase().includes('trade'),
    );
    return s?.content || '';
  }, [sections]);

  const handleCopyPlan = useCallback(() => {
    navigator.clipboard.writeText(planText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [planText]);

  const handleImplement = useCallback(async () => {
    setTaskMode(task.id, 'act');
    useUiStore.getState().setMode('act');
    setTaskStatus(task.id, 'running');
    await window.api.invoke('task:spawn', {
      taskId: task.id,
      workspaceId: task.workspaceId,
      prompt: 'Implement the plan above.',
      agentId: task.agentId,
      model: task.model,
      mode: 'act',
      thinking: task.thinking,
      cwd: task.cwd,
      sessionId: task.sessionId,
    });
  }, [task, setTaskMode, setTaskStatus]);

  const canAct = planText.length > 0;

  return (
    <div className={`premium-plan-card overflow-hidden rounded-lg ${
      isStreaming ? 'border-plan/20' : ''
    }`}>
      {/* Header */}
      <div className="plan-card-header flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="plan-card-icon-badge flex h-7 w-7 items-center justify-center rounded-lg bg-plan/10 text-plan">
            <ClipboardList size={14} />
          </div>
          <span className="text-[13px] font-semibold text-text-primary">
            {isStreaming ? 'Generating plan...' : 'Plan'}
          </span>
          {isStreaming && (
            <span className="h-1.5 w-1.5 rounded-full bg-plan animate-pulse" />
          )}
          {!isStreaming && steps.length > 0 && (
            <span className="text-[11px] text-text-tertiary">
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {canAct && !isStreaming && (
          <button
            onClick={handleCopyPlan}
            className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary hover:text-text-secondary"
            title="Copy plan"
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && !isStreaming && (
        <div className="px-4 py-3 border-b border-border/50">
          <p className="text-[13px] text-text-secondary leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && !isStreaming && (
        <div className="px-4 py-3">
          <ol className="plan-steps-list space-y-2.5">
            {steps.map((step, idx) => {
              const filePaths = extractFilePaths(step.details || step.title);
              return (
                <li key={idx} className="plan-step-row flex gap-3">
                  <span className="plan-step-number shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-text-primary leading-snug">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          ...markdownComponents,
                          p: ({ children }) => <>{children}</>,
                        }}
                      >
                        {step.title}
                      </ReactMarkdown>
                    </span>
                    {step.details && (
                      <div className="mt-1 text-[12px] text-text-tertiary leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {step.details}
                        </ReactMarkdown>
                      </div>
                    )}
                    {filePaths.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {filePaths.map((fp) => (
                          <span
                            key={fp}
                            className="plan-file-badge inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary"
                          >
                            {fp.split('/').pop()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Sections that aren't summary/steps/considerations (fallback for unparsed content) */}
      {sections
        .filter((s) => {
          const t = s.title.toLowerCase();
          return (
            !t.includes('summary') &&
            !t.includes('overview') &&
            !t.includes('step') &&
            !t.includes('consideration') &&
            !t.includes('risk') &&
            !t.includes('trade') &&
            s.content.trim()
          );
        })
        .map((section, idx) => (
          <div key={idx} className="px-4 py-3 border-t border-border/50">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
              {section.title}
            </div>
            <div className="markdown-prose text-[13px] text-text-primary">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {section.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}

      {/* Considerations */}
      {considerations && !isStreaming && (
        <div className="px-4 py-2.5 border-t border-border/50">
          <div className="flex items-start gap-2 text-[12px] text-text-tertiary">
            <AlertTriangle size={12} className="shrink-0 mt-0.5 text-warning" />
            <div className="markdown-prose leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {considerations}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* Streaming fallback — show raw content */}
      {isStreaming && !summary && sections.length === 0 && planText && (
        <div className="px-4 py-3">
          <div className="markdown-prose text-[13px] text-text-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {planText}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Action bar */}
      {canAct && !isStreaming && (
        <div className="plan-card-actions flex items-center justify-end border-t border-border px-4 py-3">
          <button
            onClick={handleImplement}
            className="plan-implement-btn flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all"
          >
            <Play size={13} />
            Implement
          </button>
        </div>
      )}
    </div>
  );
}
