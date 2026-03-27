import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, Send, Square, ExternalLink, Eye, GitMerge, Bot, User, Wrench, AlertCircle, CheckCircle, Clock, MessageSquare, ChevronDown, ChevronRight, Loader2, ArrowRight } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChatStore } from '../../stores/chat';
import { WorkspaceLifecycleIcon } from './WorkspaceLifecycleIcon';
import { workspaceOutcomeConfig, getWorkspaceLifecycleState, workspaceLifecycleConfig } from '../../lib/workspace-status';
import type { AgentMessage } from '../../lib/types';
import type { Workspace } from '../../lib/ipc-api';

/** Filters agent messages into a comment-like activity thread */
function buildActivityThread(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((msg) => {
    // Show text messages (agent commentary / user prompts)
    if (msg.type === 'text' && msg.content.trim().length > 0) return true;
    // Show tool calls (summarized)
    if (msg.type === 'tool_call') return true;
    // Show errors
    if (msg.type === 'error') return true;
    // Show results
    if (msg.type === 'result') return true;
    // Show status with progress kind
    if (msg.type === 'status' && msg.statusKind === 'progress') return true;
    // Show lifecycle/phase-transition messages
    if (msg.type === 'lifecycle') return true;
    return false;
  });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString();
}

function ActivityMessage({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  if (message.type === 'tool_call') {
    return (
      <div className="flex items-start gap-2 px-4 py-1.5">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated/60">
          <Wrench size={10} className="text-text-tertiary" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-text-tertiary">
            {message.toolName}
          </span>
          {message.toolInput?.file_path != null && (
            <span className="ml-1 text-[11px] text-text-tertiary/60">
              {String(message.toolInput.file_path as string).split('/').pop()}
            </span>
          )}
          {message.toolInput?.command != null && (
            <span className="ml-1 text-[11px] font-mono text-text-tertiary/60">
              {String(message.toolInput.command as string).slice(0, 60)}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-text-tertiary/40">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  if (message.type === 'error') {
    return (
      <div className="mx-4 my-1.5 rounded-lg border border-error/20 bg-error/5 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <AlertCircle size={12} className="shrink-0 text-error" />
          <span className="text-[11px] font-medium text-error">Error</span>
          <span className="ml-auto text-[10px] text-text-tertiary/40">{formatTime(message.timestamp)}</span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-error/80">{message.content.slice(0, 300)}</p>
      </div>
    );
  }

  if (message.type === 'result') {
    return (
      <div className="mx-4 my-1.5 rounded-lg border border-success/20 bg-success/5 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} className="shrink-0 text-success" />
          <span className="text-[11px] font-medium text-success">Completed</span>
          <span className="ml-auto text-[10px] text-text-tertiary/40">{formatTime(message.timestamp)}</span>
        </div>
        {message.content.trim() && (
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{message.content.slice(0, 300)}</p>
        )}
      </div>
    );
  }

  if (message.type === 'lifecycle') {
    return (
      <div className="mx-4 my-2">
        <div className="flex items-center gap-2 rounded-lg border border-accent/15 bg-accent/5 px-3 py-2">
          <ArrowRight size={12} className="shrink-0 text-accent" />
          <span className="flex-1 text-[11px] font-medium text-accent">{message.content}</span>
          <span className="shrink-0 text-[10px] text-text-tertiary/40">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  if (message.type === 'status') {
    return (
      <div className="flex items-center gap-2 px-4 py-1">
        <Clock size={10} className="shrink-0 text-text-tertiary/40" />
        <span className="text-[11px] text-text-tertiary/60">{message.content}</span>
        <span className="ml-auto text-[10px] text-text-tertiary/40">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  // Text messages — the main comment-like items
  return (
    <div className={`mx-4 my-2 ${isUser ? 'ml-8' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-accent/10' : 'bg-bg-elevated/80'
        }`}>
          {isUser ? <User size={12} className="text-accent" /> : <Bot size={12} className="text-text-secondary" />}
        </div>
        <span className="text-[11px] font-semibold text-text-primary">
          {isUser ? 'You' : 'Agent'}
        </span>
        <span className="text-[10px] text-text-tertiary/50">{formatTime(message.timestamp)}</span>
      </div>
      <div className={`mt-1 rounded-lg px-3 py-2 ${
        isUser
          ? 'ml-8 border border-accent/15 bg-accent/5'
          : 'ml-8 border border-border/30 bg-bg-surface/50'
      }`}>
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-primary">
          {message.content.slice(0, 2000)}
        </p>
      </div>
    </div>
  );
}

/** Collapsible group of tool calls between text messages */
function ToolCallGroup({ messages }: { messages: AgentMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) return null;

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-4 py-1 text-[11px] text-text-tertiary/60 hover:text-text-tertiary transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Wrench size={10} />
        <span>{messages.length} tool call{messages.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && messages.map((msg, i) => (
        <ActivityMessage key={i} message={msg} />
      ))}
    </div>
  );
}

/** Groups consecutive tool calls together for a cleaner thread */
function ThreadView({ messages }: { messages: AgentMessage[] }) {
  const groups: Array<{ type: 'message'; message: AgentMessage } | { type: 'tools'; messages: AgentMessage[] }> = [];

  let currentTools: AgentMessage[] = [];
  for (const msg of messages) {
    if (msg.type === 'tool_call') {
      currentTools.push(msg);
    } else {
      if (currentTools.length > 0) {
        groups.push({ type: 'tools', messages: currentTools });
        currentTools = [];
      }
      groups.push({ type: 'message', message: msg });
    }
  }
  if (currentTools.length > 0) {
    groups.push({ type: 'tools', messages: currentTools });
  }

  return (
    <>
      {groups.map((group, i) =>
        group.type === 'tools' ? (
          <ToolCallGroup key={i} messages={group.messages} />
        ) : (
          <ActivityMessage key={i} message={group.message} />
        ),
      )}
    </>
  );
}

export function WorkspaceDetailPanel() {
  const workspaceId = useUiStore((s) => s.detailPanelWorkspaceId);
  const closeDetailPanel = useUiStore((s) => s.closeDetailPanel);
  const workspace = useWorkspaceStore((s) => workspaceId ? s.workspaces.get(workspaceId) : undefined);
  const tasks = useChatStore((s) => s.tasks);

  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Find tasks for this workspace
  const workspaceTasks = useMemo(() => {
    if (!workspaceId) return [];
    return Array.from(tasks.values())
      .filter((t) => t.workspaceId === workspaceId)
      .sort((a, b) => (a.activeRun?.startedAt ?? 0) - (b.activeRun?.startedAt ?? 0));
  }, [tasks, workspaceId]);

  // Combine all messages from workspace tasks into a single thread
  const allMessages = useMemo(() => {
    const msgs: AgentMessage[] = [];
    for (const task of workspaceTasks) {
      msgs.push(...task.messages);
    }
    return buildActivityThread(msgs);
  }, [workspaceTasks]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length]);

  const activeTask = workspaceTasks.find((t) => t.status === 'running');
  const isRunning = !!activeTask || workspace?.status === 'running';

  const handleSendComment = useCallback(async () => {
    if (!comment.trim() || !workspaceId) return;
    const trimmed = comment.trim();
    setComment('');
    setSending(true);

    try {
      if (activeTask) {
        // Steer the running task
        await window.api.invoke('task:steer', { taskId: activeTask.id, prompt: trimmed });
      } else {
        // Spawn a new chat on the workspace
        await window.api.invoke('workspace:spawn-chat', { workspaceId, prompt: trimmed });
      }
    } catch {
      // Restore comment on failure
      setComment(trimmed);
    } finally {
      setSending(false);
    }
  }, [comment, workspaceId, activeTask]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendComment();
    }
  }, [handleSendComment]);

  if (!workspaceId || !workspace) return null;

  const lifecycleState = getWorkspaceLifecycleState(workspace);
  const lifecycle = workspaceLifecycleConfig[lifecycleState] ?? workspaceLifecycleConfig.idle;
  const outcomeCfg = workspaceOutcomeConfig[workspace.outcome];

  return (
    <div className="flex h-full w-[420px] min-w-[420px] flex-col border-l border-border/50 bg-bg-primary">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <WorkspaceLifecycleIcon state={lifecycleState} size={14} className={lifecycle.iconColor} />
            <h3 className="truncate text-[13px] font-semibold text-text-primary">{workspace.name}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${lifecycle.badgeClass}`}>
              {lifecycle.label}
            </span>
            <span className="text-[10px] text-text-tertiary">{workspace.branch}</span>
          </div>
        </div>
        <button
          onClick={closeDetailPanel}
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      {/* Workspace info summary */}
      <div className="shrink-0 border-b border-border/30 px-4 py-3">
        <div className="grid grid-cols-2 gap-y-2 text-[11px]">
          <div>
            <span className="text-text-tertiary">Assignee</span>
            <p className="font-medium text-text-primary">{workspace.agentId} · {workspace.model}</p>
          </div>
          <div>
            <span className="text-text-tertiary">Outcome</span>
            <p className={`font-medium ${outcomeCfg.color}`}>{outcomeCfg.label}</p>
          </div>
        </div>
      </div>

      {/* Activity thread */}
      <div className="flex-1 overflow-y-auto py-3">
        {allMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <MessageSquare size={28} className="text-text-tertiary/30" />
            <p className="mt-3 text-[12px] text-text-tertiary">No activity yet</p>
            <p className="mt-1 text-[11px] text-text-tertiary/60">
              Send a message to start working on this workspace
            </p>
          </div>
        ) : (
          <ThreadView messages={allMessages} />
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Comment input */}
      <div className="shrink-0 border-t border-border/50 px-4 py-3">
        {isRunning && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-accent">
            <Loader2 size={10} className="animate-spin" />
            <span>Agent is working — your message will steer the current task</span>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Steer the agent...' : 'Send a message...'}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border/50 bg-bg-surface/50 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-tertiary/40 focus:border-accent/40 focus:outline-none"
          />
          <button
            onClick={handleSendComment}
            disabled={!comment.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-lg bg-accent text-white transition-colors hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
        <span className="mt-1 block text-[10px] text-text-tertiary/40">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
        </span>
      </div>
    </div>
  );
}
