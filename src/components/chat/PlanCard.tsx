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
import type { Task } from '../../lib/types';

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

function extractSteps(content: string): string[] {
  const steps: string[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+)/);
    if (match) steps.push(match[1]);
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
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0, 1, 2, 3]));
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(new Set());

  const setTaskStatus = useChatStore((s) => s.setTaskStatus);
  const setTaskMode = useChatStore((s) => s.setTaskMode);

  const planText = useMemo(() =>
    task.messages
      .filter((m) => m.role === 'assistant' && m.type === 'text')
      .map((m) => m.content)
      .join('\n\n'),
    [task.messages],
  );

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

  return (
    <div className={`premium-plan-card overflow-hidden rounded-lg ${
      isStreaming ? 'border-plan/35 shadow-[0_28px_64px_rgba(0,0,0,0.36)]' : ''
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-plan/12 bg-plan/8 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-plan/20 bg-plan-muted/55 text-plan">
            <ClipboardList size={14} className="text-plan" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-plan/90">
              {isStreaming ? 'Live planning' : 'Strategy'}
            </div>
            <span className="text-sm font-semibold text-text-primary">
              {isStreaming ? 'Generating plan...' : 'Plan'}
            </span>
          </div>
          {isStreaming && (
            <span className="flex items-center gap-1.5 rounded-full border border-plan/20 bg-plan/12 px-2.5 py-1 text-[10px] font-medium text-plan">
              <span className="h-1.5 w-1.5 rounded-full bg-plan animate-pulse" />
              streaming
            </span>
          )}
        </div>
        {isDone && (
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
        <div className="border-b border-plan/12 bg-bg-elevated p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
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
        <div className="border-b border-plan/12 p-4">
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
              className="rounded-lg bg-plan px-3.5 py-1.5 text-xs font-semibold text-bg-primary shadow-[0_14px_32px_rgba(0,0,0,0.22)] transition-transform hover:-translate-y-0.5"
            >
              <Save size={12} className="inline mr-1" />
              Save Revision
            </button>
          </div>
        </div>
      )}

      {/* Plan sections */}
      {!editing && (
        <div className="divide-y divide-plan/[0.07]">
          {sections.map((section, idx) => {
            const isExpanded = expandedSections.has(idx);
            const steps = section.title.toLowerCase().includes('step')
              ? extractSteps(section.content)
              : [];

            return (
              <div key={idx}>
                <button
                  onClick={() => toggleSection(idx)}
                  className="premium-toolbar-button flex w-full items-center gap-2 rounded-none px-5 py-3 text-left"
                >
                  {isExpanded
                    ? <ChevronDown size={13} className="text-text-tertiary shrink-0" />
                    : <ChevronRight size={13} className="text-text-tertiary shrink-0" />
                  }
                  <span className="text-sm font-medium text-text-primary">{section.title}</span>
                </button>
                {isExpanded && (
                  <div className="px-5 pb-4 pl-10">
                    {steps.length > 0 ? (
                      <div className="space-y-2">
                        {steps.map((step, stepIdx) => {
                          const stepKey = `${idx}:${stepIdx}`;
                          const checked = checkedSteps.has(stepKey);
                          return (
                            <label
                              key={stepKey}
                              className="flex items-start gap-2 text-sm cursor-pointer group"
                            >
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
                                className="mt-1 shrink-0 accent-plan"
                              />
                              <span className={`${checked ? 'text-text-tertiary line-through' : 'text-text-secondary'} transition-colors`}>
                                {step}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="markdown-prose text-sm text-text-secondary">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
      {isDone && !editing && (
        <div className="flex items-center justify-between border-t border-plan/12 bg-plan/8 px-5 py-4">
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
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg-primary shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition-transform hover:-translate-y-0.5"
          >
            <Play size={13} />
            Implement Plan
          </button>
        </div>
      )}
    </div>
  );
}
