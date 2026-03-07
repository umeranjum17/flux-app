import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Trash2, GitFork, Play } from 'lucide-react';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import type { AgentId, TaskMode, AgentMessage } from '../../lib/types';
import type { SessionMessage } from '../../lib/ipc-api';

export function SessionPicker() {
  const { activeOverlay, setOverlay } = useUiStore();
  const { sessions, removeSession } = useSessionStore();
  const [filter, setFilter] = useState('');

  const open = activeOverlay === 'session-picker';

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(filter.toLowerCase()) ||
    s.agentId.toLowerCase().includes(filter.toLowerCase()),
  );

  const loadSessionIntoTask = async (sessionId: string, withSessionId: boolean) => {
    setOverlay(null);
    const session = await window.api.invoke('sessions:get', { id: sessionId }) as any;
    if (!session) return;

    const messages = await window.api.invoke('sessions:messages', { id: sessionId }) as SessionMessage[];
    const taskId = crypto.randomUUID();

    const { createTask, addMessage, setActiveTask, setTaskStatus } = useChatStore.getState();
    const { selectedThinking } = useAgentStore.getState();

    createTask({
      id: taskId,
      title: session.title,
      agentId: (session.agentId || 'claude-code') as AgentId,
      model: session.model || '',
      mode: (session.mode || 'act') as TaskMode,
      thinking: selectedThinking,
      cwd: session.cwd || useUiStore.getState().cwd || '.',
      sessionId: withSessionId ? sessionId : undefined,
    });

    for (const msg of messages) {
      addMessage(taskId, {
        type: msg.type as AgentMessage['type'],
        role: msg.role as AgentMessage['role'],
        content: msg.content,
        timestamp: msg.timestamp,
        toolName: msg.toolName ?? undefined,
        toolCallId: msg.toolCallId ?? undefined,
      });
    }

    setTaskStatus(taskId, 'idle');
    setActiveTask(taskId);
  };

  const handleResume = async (sessionId: string) => {
    await loadSessionIntoTask(sessionId, true);
  };

  const handleFork = async (sessionId: string) => {
    await loadSessionIntoTask(sessionId, false);
  };

  const handleDelete = async (sessionId: string) => {
    await window.api.invoke('sessions:delete', { id: sessionId });
    removeSession(sessionId);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOverlay(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="bg-bg-elevated rounded-2xl p-6 max-w-md w-full mx-4 border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">Sessions</h2>
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative mb-4">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search sessions..."
                className="w-full bg-bg-primary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors"
              />
            </div>

            <div className="space-y-1 max-h-80 overflow-y-auto">
              {filtered.map((session) => (
                <div
                  key={session.id}
                  className="group px-3 py-3 rounded-lg hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {session.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-tertiary">{session.agentId}</span>
                        <span className="text-xs text-text-tertiary">
                          {session.model}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {formatDate(session.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleResume(session.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-white hover:opacity-90 transition-opacity"
                    >
                      <Play size={12} />
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFork(session.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-text-secondary bg-bg-primary border border-border hover:bg-bg-hover transition-colors"
                    >
                      <GitFork size={12} />
                      Fork
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(session.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-error hover:bg-error/10 transition-colors ml-auto"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}

              {filtered.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-8">
                  {sessions.length === 0 ? 'No sessions yet.' : 'No matching sessions.'}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
