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
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());

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
        await window.api.invoke('checkpoint:list', { workspaceId: task.id });
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
    <div className={`rounded-xl border overflow-hidden shadow-sm ${
      isStreaming
        ? 'border-accent/30'
        : 'border-accent/15'
    } bg-accent/[0.02]`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-accent/8 bg-accent/[0.04]">
        <div className="flex items-center gap-2.5">
          <div className={`p-1 rounded-md ${isStreaming ? 'bg-accent/15' : 'bg-accent/10'}`}>
            <ClipboardList size={13} className="text-accent" />
          </div>
          <span className="text-[13px] font-semibold text-text-primary">
            {isStreaming ? 'Generating plan...' : 'Plan'}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              streaming
            </span>
          )}
        </div>
        {isDone && (
          <div className="flex items-center gap-1">
            {revisions.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={`${revisions.length} previous revision${revisions.length === 1 ? '' : 's'}`}
              >
                <History size={13} />
              </button>
            )}
            <button
              onClick={handleEdit}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Edit plan"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleCopyPlan}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Copy plan"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>

      {/* Revision history dropdown */}
      {showHistory && revisions.length > 0 && (
        <div className="border-b border-accent/10 bg-bg-primary/50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Previous Revisions
          </div>
          <div className="space-y-1.5">
            {revisions.map((rev, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-bg-elevated px-3 py-2 text-xs">
                <span className="text-text-secondary">Revision {i + 1}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(rev);
                    toast.success(`Revision ${i + 1} copied`);
                  }}
                  className="text-text-tertiary hover:text-text-primary"
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
        <div className="p-3 border-b border-accent/10">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full min-h-[200px] rounded-lg border border-border bg-bg-primary p-3 text-sm font-mono text-text-primary resize-y outline-none focus:border-accent"
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-md text-xs text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <X size={12} className="inline mr-1" />
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              <Save size={12} className="inline mr-1" />
              Save Revision
            </button>
          </div>
        </div>
      )}

      {/* Plan sections */}
      {!editing && (
        <div className="divide-y divide-accent/[0.07]">
          {sections.map((section, idx) => {
            const isExpanded = expandedSections.has(idx);
            const steps = section.title.toLowerCase().includes('step')
              ? extractSteps(section.content)
              : [];

            return (
              <div key={idx}>
                <button
                  onClick={() => toggleSection(idx)}
                  className="flex items-center gap-2 w-full text-left px-4 py-2.5 hover:bg-accent/[0.03] transition-colors"
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
                      <div className="space-y-2">
                        {steps.map((step, stepIdx) => (
                          <label
                            key={stepIdx}
                            className="flex items-start gap-2 text-sm cursor-pointer group"
                          >
                            <input
                              type="checkbox"
                              checked={checkedSteps.has(stepIdx)}
                              onChange={() => {
                                setCheckedSteps((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(stepIdx)) next.delete(stepIdx);
                                  else next.add(stepIdx);
                                  return next;
                                });
                              }}
                              className="mt-1 shrink-0 accent-accent"
                            />
                            <span className={`${checkedSteps.has(stepIdx) ? 'text-text-tertiary line-through' : 'text-text-secondary'} transition-colors`}>
                              {step}
                            </span>
                          </label>
                        ))}
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
        <div className="flex items-center justify-between px-4 py-3 border-t border-accent/8 bg-accent/[0.04]">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
              <input
                type="checkbox"
                checked={showCheckpoint}
                onChange={(e) => setShowCheckpoint(e.target.checked)}
                className="accent-accent rounded"
              />
              <GitBranch size={11} />
              Checkpoint before implementing
            </label>
          </div>
          <button
            onClick={handleImplement}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold bg-success text-white hover:opacity-90 transition-all shadow-sm"
          >
            <Play size={12} />
            Implement Plan
          </button>
        </div>
      )}
    </div>
  );
}
