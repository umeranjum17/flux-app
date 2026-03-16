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
} from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useUiStore } from '../../stores/ui';
import { markdownComponents } from './MarkdownComponents';
import type { Task } from '../../lib/types';
import { getLatestPlanText } from '../../lib/plan';

interface PlanSection {
  title: string;
  content: string;
}

function parsePlanSections(text: string): PlanSection[] {
  const sections: PlanSection[] = [];
  const lines = text.split('\n');
  let currentTitle = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentTitle || currentContent.length > 0) {
        sections.push({
          title: currentTitle || 'Overview',
          content: currentContent.join('\n').trim(),
        });
      }
      currentTitle = headingMatch[1];
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

interface StepInfo {
  title: string;
  body: string;
}

function extractSteps(content: string): StepInfo[] {
  const steps: StepInfo[] = [];
  const lines = content.split('\n');
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) {
      if (currentTitle) {
        steps.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = match[1];
      currentBody = [];
    } else if (currentTitle) {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    steps.push({ title: currentTitle, body: currentBody.join('\n').trim() });
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

  const sections = useMemo(() => parsePlanSections(planText), [planText]);
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
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-plan/10 text-plan">
            <ClipboardList size={13} />
          </div>
          <span className="text-[13px] font-medium text-text-primary">
            {isStreaming ? 'Generating plan...' : 'Plan'}
          </span>
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
        <div className="divide-y divide-border/60">
          {sections.map((section, idx) => {
            const isExpanded = expandedSections.has(idx);
            const steps = section.title.toLowerCase().includes('step')
              ? extractSteps(section.content)
              : [];

            return (
              <div key={idx}>
                <button
                  onClick={() => toggleSection(idx)}
                  className="premium-toolbar-button flex w-full items-center gap-2 rounded-none px-4 py-2.5 text-left"
                >
                  {isExpanded
                    ? <ChevronDown size={13} className="text-text-tertiary shrink-0" />
                    : <ChevronRight size={13} className="text-text-tertiary shrink-0" />
                  }
                  <span className="text-sm font-medium text-text-primary">{section.title}</span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-3 pl-9">
                    {steps.length > 0 ? (
                      <div className="space-y-3">
                        {steps.map((step, stepIdx) => {
                          const stepKey = `${idx}:${stepIdx}`;
                          const checked = checkedSteps.has(stepKey);
                          return (
                            <div key={stepKey} className="flex items-start gap-2 text-sm group">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setCheckedSteps((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(stepKey)) next.delete(stepKey);
                                    else next.add(stepKey);
                                    return next;
                                  });
                                }}
                                className="mt-1 shrink-0 accent-plan cursor-pointer"
                              />
                              <div className={`${checked ? 'text-text-tertiary line-through' : 'text-text-primary'} transition-colors min-w-0 flex-1`}>
                                <span className="font-medium">{step.title}</span>
                                {step.body && (
                                  <div className="markdown-prose mt-1 text-sm">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                      {step.body}
                                    </ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="markdown-prose text-sm text-text-primary">
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
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
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
            className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-success/85"
          >
            <Play size={13} />
            Implement Plan
          </button>
        </div>
      )}
    </div>
  );
}
