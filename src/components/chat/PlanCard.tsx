import React, { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ClipboardList,
  Copy,
  Check,
  Play,
  Pencil,
  X,
  ChevronDown,
  ChevronRight,
  Save,
  History,
  GitBranch,
  FileText,
  Search,
  ListOrdered,
  Scale,
  ShieldCheck,
  Lightbulb,
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { markdownComponents } from './MarkdownComponents';
import type { Task, PlanSection, PlanStep } from '../../lib/types';
import { getLatestPlanText } from '../../lib/plan';

/** Map section title keywords to icons and accent colors */
function getSectionMeta(title: string): { icon: React.ReactNode; accent: string } {
  const t = title.toLowerCase();
  if (t.includes('summary') || t.includes('overview'))
    return { icon: <FileText size={13} />, accent: 'text-info' };
  if (t.includes('analysis') || t.includes('context'))
    return { icon: <Search size={13} />, accent: 'text-warning' };
  if (t.includes('step') || t.includes('implementation') || t.includes('plan'))
    return { icon: <ListOrdered size={13} />, accent: 'text-success' };
  if (t.includes('trade') || t.includes('consideration') || t.includes('risk'))
    return { icon: <Scale size={13} />, accent: 'text-warning' };
  if (t.includes('verification') || t.includes('test') || t.includes('validate'))
    return { icon: <ShieldCheck size={13} />, accent: 'text-info' };
  return { icon: <Lightbulb size={13} />, accent: 'text-text-secondary' };
}

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
      // Clean bold prefix: **Title**: details
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

interface PlanCardProps {
  task: Task;
  isStreaming?: boolean;
}

export function PlanCard({ task, isStreaming }: PlanCardProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(new Set());

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
    // Fallback: extract from the "Steps" section in markdown
    const stepsSection = sections.find((s) => s.title.toLowerCase().includes('step'));
    return stepsSection ? extractStepsFromMarkdown(stepsSection.content) : [];
  }, [task.planData, sections]);

  const revisions = task.planRevisions ?? [];

  const toggleSection = useCallback((idx: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleCopyPlan = useCallback(() => {
    navigator.clipboard.writeText(planText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [planText]);

  const handleEdit = useCallback(() => {
    setEditText(planText);
    setEditing(true);
  }, [planText]);

  const handleSaveEdit = useCallback(() => {
    // Save current plan as a revision
    useChatStore.setState((state) => {
      const t = state.tasks.get(task.id);
      if (!t) return;
      if (!t.planRevisions) t.planRevisions = [];
      t.planRevisions.push(planText);
    });
    setEditing(false);
    toast.success('Plan revision saved');
  }, [task.id, planText]);

  const handleImplement = useCallback(async () => {
    if (showCheckpoint) {
      try {
        await window.api.invoke('checkpoint:list', { workspaceId: task.workspaceId ?? task.id });
        toast.success('Checkpoint created');
      } catch {
        // Checkpoint not available for this workspace — proceed anyway
      }
    }

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
  }, [task, setTaskMode, setTaskStatus, showCheckpoint]);

  const totalSteps = steps.length;
  const completedSteps = steps.filter((_, i) => checkedSteps.has(`step:${i}`)).length;

  const isDone = task.status === 'done';
  // Show action bar whenever plan text is available — the SDK may not call
  // ExitPlanMode, leaving the task stuck in 'running'. This ensures the user
  // can always proceed to implementation once plan content is detected.
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
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-text-primary leading-tight">
              {isStreaming ? 'Generating plan...' : 'Plan'}
            </span>
            {!isStreaming && totalSteps > 0 && (
              <span className="text-[11px] text-text-tertiary leading-tight">
                {completedSteps}/{totalSteps} steps completed
              </span>
            )}
          </div>
          {isStreaming && (
            <span className="h-1.5 w-1.5 rounded-full bg-plan animate-pulse" />
          )}
        </div>
        {canAct && !isStreaming && (
          <div className="flex items-center gap-1">
            {revisions.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary"
                title={`${revisions.length} previous revision${revisions.length === 1 ? '' : 's'}`}
              >
                <History size={13} />
              </button>
            )}
            <button
              onClick={handleEdit}
              className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary"
              title="Edit plan"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleCopyPlan}
              className="premium-toolbar-button rounded-lg p-1.5 text-text-tertiary"
              title="Copy plan"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>

      {/* Revision history dropdown */}
      {showHistory && revisions.length > 0 && (
        <div className="border-b border-border bg-bg-elevated p-4">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Previous Revisions
          </div>
          <div className="space-y-2">
            {revisions.map((rev, i) => (
              <div key={i} className="premium-panel flex items-center justify-between rounded-lg px-3 py-2 text-xs">
                <span className="text-text-secondary">Revision {i + 1}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(rev);
                    toast.success(`Revision ${i + 1} copied`);
                  }}
                  className="premium-toolbar-button rounded-lg p-1 text-text-tertiary"
                  title={`Copy revision ${i + 1}`}
                  aria-label={`Copy revision ${i + 1}`}
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="border-b border-border p-4">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="premium-focus min-h-[220px] w-full resize-y rounded-lg border border-border bg-bg-primary/75 p-4 text-sm font-mono text-text-primary outline-none focus:border-plan"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="premium-toolbar-button rounded-lg px-3 py-1.5 text-xs text-text-secondary"
            >
              <X size={12} className="inline mr-1" />
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="rounded-lg bg-plan px-3.5 py-1.5 text-xs font-semibold text-bg-primary transition-colors hover:bg-plan-hover"
            >
              <Save size={12} className="inline mr-1" />
              Save Revision
            </button>
          </div>
        </div>
      )}

      {/* Plan sections */}
      {!editing && (
        <div className="plan-card-sections">
          {sections.map((section, idx) => {
            const isExpanded = expandedSections.has(idx);
            const isStepSection = section.title.toLowerCase().includes('step');
            const sectionSteps = isStepSection ? steps : [];
            const meta = getSectionMeta(section.title);
            const sectionChecked = sectionSteps.filter((_, i) => checkedSteps.has(`step:${i}`)).length;

            return (
              <div key={idx} className="plan-card-section">
                <button
                  onClick={() => toggleSection(idx)}
                  className="plan-section-header flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-bg-hover/50"
                >
                  <span className={`plan-section-icon shrink-0 ${meta.accent}`}>
                    {meta.icon}
                  </span>
                  {isExpanded
                    ? <ChevronDown size={12} className="text-text-tertiary shrink-0" />
                    : <ChevronRight size={12} className="text-text-tertiary shrink-0" />
                  }
                  <span className="text-[13px] font-semibold text-text-primary flex-1">{section.title}</span>
                  {sectionSteps.length > 0 && (
                    <span className="plan-step-count text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                      {sectionChecked}/{sectionSteps.length}
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 pl-[2.75rem]">
                    {sectionSteps.length > 0 ? (
                      <div className="plan-step-timeline relative">
                        {sectionSteps.map((step, stepIdx) => {
                          const stepKey = `step:${stepIdx}`;
                          const checked = checkedSteps.has(stepKey);
                          const isLast = stepIdx === sectionSteps.length - 1;
                          return (
                            <div key={stepKey} className="plan-step-item flex items-start gap-3 group relative">
                              {/* Timeline connector */}
                              {!isLast && (
                                <div className="plan-step-connector" />
                              )}
                              {/* Numbered badge */}
                              <button
                                onClick={() => {
                                  setCheckedSteps((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(stepKey)) next.delete(stepKey);
                                    else next.add(stepKey);
                                    return next;
                                  });
                                }}
                                className={`plan-step-badge shrink-0 ${checked ? 'plan-step-badge-done' : ''}`}
                                title={checked ? 'Mark incomplete' : 'Mark complete'}
                              >
                                {checked ? <Check size={10} /> : <span className="text-[10px] font-semibold">{stepIdx + 1}</span>}
                              </button>
                              {/* Step content */}
                              <div className={`plan-step-content flex-1 min-w-0 pb-4 ${checked ? 'opacity-50' : ''}`}>
                                <span className={`markdown-inline text-[13px] font-medium leading-snug ${checked ? 'text-text-tertiary line-through' : 'text-text-primary'} transition-colors`}>
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
                                  <div className="markdown-prose mt-1.5 text-[12.5px] text-text-secondary">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                      {step.details}
                                    </ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="markdown-prose text-[13px] text-text-primary">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {section.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      {canAct && !editing && (
        <div className="plan-card-actions border-t border-border">
          {/* Progress bar */}
          {totalSteps > 0 && (
            <div className="px-4 pt-3">
              <div className="plan-progress-track">
                <div
                  className="plan-progress-fill"
                  style={{ width: `${totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCheckpoint}
                  onChange={(e) => setShowCheckpoint(e.target.checked)}
                  className="accent-plan"
                />
                <GitBranch size={11} />
                Checkpoint before implementing
              </label>
            </div>
            <button
              onClick={handleImplement}
              className="plan-implement-btn flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all"
            >
              <Play size={13} />
              Implement Plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
