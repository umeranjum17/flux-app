import { useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react';
import { ArrowUp, Plus, X, RotateCcw, Brain, Terminal, ChevronDown, BookOpen, Square, Gauge, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';
import { ImageAttach } from './ImageAttach';
import { SlashMenu } from './SlashMenu';
import { FileMention } from './FileMention';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import type { FluxConfig, RateLimitInfo, Session } from '../../lib/ipc-api';
import type { FileAttachment, ThinkingLevel } from '../../lib/types';
import { createWorkspaceAndChat, startWorkspaceChat } from '../../lib/workspace-state';
import { isTerminalOutcome } from '../../lib/workspace-status';
import {
  computeHighestSeverity,
  formatTimeUntil,
  mergeRateLimits,
  normalizeTaskRateLimit,
  providerLabel,
  rateLimitTextColor,
} from '../../lib/rate-limits';

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
};

interface ChatInputProps {
  focused?: boolean;
}

export function ChatInput({ focused }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [showSlash, setShowSlash] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [showSubagentDialog, setShowSubagentDialog] = useState(false);
  const [subagentModel, setSubagentModel] = useState('haiku');
  const [subagentDrafts, setSubagentDrafts] = useState([{ name: 'Explore', prompt: '' }]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showCompletionPicker, setShowCompletionPicker] = useState(false);
  const [completionProviders, setCompletionProviders] = useState<string[]>([]);
  const [showRateLimits, setShowRateLimits] = useState(false);
  const [cachedRateLimits, setCachedRateLimits] = useState<RateLimitInfo[]>([]);
  const [rateLimitsUpdatedAt, setRateLimitsUpdatedAt] = useState<number | null>(null);

  // Guard against accidental sends in completed/merged workspaces
  const [pendingTerminalSend, setPendingTerminalSend] = useState(false);
  const confirmedTerminalSend = useRef(false);

  // Terminal / ghost text state
  const [ghostText, setGhostText] = useState('');
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIndex = useRef(-1);
  const hasMountedTaskContext = useRef(false);

  const { getActiveTask, createTask, addUserMessage, setTaskStatus, setTaskSessionId, setTaskMode } = useChatStore();
  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });
  const activeTaskId = useChatStore((s) => s.activeTaskId);
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const { selectedAgentId, selectedModel, selectedThinking, agents, dynamicModels } = useAgentStore();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspaceOutcome = useWorkspaceStore((s) => {
    const id = s.activeWorkspaceId;
    return id ? s.workspaces.get(id)?.outcome : undefined;
  });
  const { mode, sendKey } = useUiStore();
  const inputMode = useUiStore((s) => s.inputMode);
  const shellHistory = useUiStore((s) => s.shellHistory);
  const completionModel = useUiStore((s) => s.completionModel);
  const currentAgent = agents.find((agent) => agent.id === selectedAgentId);
  const pendingMention = useUiStore((s) => s.pendingMention);
  const cwd = useUiStore((s) => s.cwd);

  const isTerminal = inputMode === 'terminal';

  // Fetch available completion providers and auto-select a working model
  useEffect(() => {
    window.api.invoke('completion:providers').then((res) => {
      const typed = res as { providers: string[] };
      setCompletionProviders(typed.providers);

      // If the current model's provider isn't available, switch to one that is
      const currentProvider = (() => {
        if (['haiku', 'sonnet', 'opus'].includes(completionModel) || completionModel.startsWith('claude-')) return 'anthropic';
        if (completionModel.startsWith('gemini-')) return 'google';
        return 'openai';
      })();
      if (typed.providers.length > 0 && !typed.providers.includes(currentProvider)) {
        const fallback: Record<string, string> = { anthropic: 'haiku', openai: 'gpt-4o-mini', google: 'gemini-2.0-flash' };
        useUiStore.getState().setCompletionModel(fallback[typed.providers[0]] ?? 'haiku');
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRateLimits = useCallback(async () => {
    try {
      const result = await window.api.invoke('usage:rate-limits') as RateLimitInfo[] | undefined;
      if (!Array.isArray(result)) {
        setCachedRateLimits([]);
        setRateLimitsUpdatedAt(Date.now());
        return;
      }
      setCachedRateLimits(result);
      const newestFetchedAt = result.reduce(
        (max, entry) => Math.max(max, entry.fetchedAt ?? 0),
        0,
      );
      setRateLimitsUpdatedAt(newestFetchedAt > 0 ? newestFetchedAt : Date.now());
    } catch {
      setCachedRateLimits([]);
      setRateLimitsUpdatedAt(Date.now());
    }
  }, []);

  useEffect(() => {
    void refreshRateLimits();
    const interval = setInterval(() => {
      void refreshRateLimits();
    }, 60_000);
    const cleanupMessage = window.api.on('agent:message', (...args: unknown[]) => {
      const data = args[0] as { message?: { type?: string } } | undefined;
      if (data?.message?.type === 'rate_limit') {
        void refreshRateLimits();
      }
    });
    const cleanupDone = window.api.on('agent:done', () => {
      void refreshRateLimits();
    });
    return () => {
      clearInterval(interval);
      cleanupMessage();
      cleanupDone();
    };
  }, [refreshRateLimits]);

  const isMac = window.api?.platform === 'darwin';
  const activeTaskRateLimit = useMemo(
    () => normalizeTaskRateLimit(activeTask?.rateLimitInfo, activeTask?.agentId),
    [activeTask?.rateLimitInfo, activeTask?.agentId],
  );
  const visibleRateLimits = useMemo(
    () => mergeRateLimits(cachedRateLimits, activeTaskRateLimit),
    [cachedRateLimits, activeTaskRateLimit],
  );
  const highestSeverity = useMemo(
    () => computeHighestSeverity(visibleRateLimits),
    [visibleRateLimits],
  );

  // Focus textarea when panel switches to agent mode
  useEffect(() => {
    if (focused) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [focused]);

  // Handle file mention from explorer double-click
  useEffect(() => {
    if (pendingMention) {
      setAttachedFiles((prev) => {
        if (prev.some((f) => f.path === pendingMention.path)) return prev;
        return [...prev, pendingMention];
      });
      useUiStore.getState().setPendingMention(null);
      textareaRef.current?.focus();
    }
  }, [pendingMention]);

  // Reset local input state when switching tasks or workspaces so content
  // doesn't leak across workspace boundaries.
  useEffect(() => {
    if (!hasMountedTaskContext.current) {
      hasMountedTaskContext.current = true;
      return;
    }
    setValue('');
    setImages([]);
    setAttachedFiles([]);
    setGhostText('');
    setShowSlash(false);
    setShowMention(false);
    if (completionTimer.current) clearTimeout(completionTimer.current);
  }, [activeTaskId, activeWorkspaceId]);

  // When switching to terminal mode, ensure '$ ' prefix
  useEffect(() => {
    if (isTerminal && !value.startsWith('$ ')) {
      setValue('$ ');
      setGhostText('');
      historyIndex.current = -1;
    } else if (!isTerminal && value.startsWith('$ ')) {
      setValue('');
      setGhostText('');
    }
  }, [isTerminal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel pending completion timer on unmount
  useEffect(() => {
    return () => {
      if (completionTimer.current) clearTimeout(completionTimer.current);
    };
  }, []);

  const completionErrorShown = useRef(false);

  const scheduleCompletion = useCallback((prefix: string) => {
    if (completionTimer.current) clearTimeout(completionTimer.current);
    setGhostText('');

    if (!prefix.trim()) return;

    completionTimer.current = setTimeout(async () => {
      try {
        const result = await window.api.invoke('completion:suggest', {
          prefix,
          cwd: cwd || '.',
          recentCommands: shellHistory,
          model: completionModel,
        }) as { suggestion: string; error?: string };

        if (result.error === 'no_api_key' && !completionErrorShown.current) {
          completionErrorShown.current = true;
          toast.error('No API key configured for autocomplete. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.');
        }
        setGhostText(result.suggestion ?? '');
      } catch {
        setGhostText('');
      }
    }, 400);
  }, [cwd, shellHistory, completionModel]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 8;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text) return;

    // ── Terminal mode: run shell command ──
    if (isTerminal && text.startsWith('$ ')) {
      const command = text.slice(2).trim();
      if (!command) return;

      let task = getActiveTask();
      if (!task) {
        const taskId = crypto.randomUUID();
        createTask({
          id: taskId,
          title: `$ ${command}`.slice(0, 80),
          agentId: selectedAgentId,
          model: selectedModel,
          mode,
          thinking: selectedThinking,
          cwd: cwd || '.',
        });
        task = useChatStore.getState().tasks.get(taskId)!;
      }

      addUserMessage(task.id, `$ ${command}`);
      useUiStore.getState().addShellCommand(command);
      historyIndex.current = -1;
      setValue('$ ');
      setGhostText('');

      try {
        const result = await window.api.invoke('shell:exec', {
          command,
          cwd: task.cwd || cwd || '.',
        }) as { stdout: string; stderr: string; exitCode: number; durationMs: number };

        useChatStore.getState().addMessage(task.id, {
          type: 'shell_result',
          role: 'assistant',
          content: '',
          command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Shell command failed';
        toast.error(message);
      }
      return;
    }

    // ── Chat mode: agent conversation ──
    let task = getActiveTask();
    const attachments = attachedFiles.length > 0 ? attachedFiles : undefined;

    // Guard: Warn before starting a new agent run in a completed/merged workspace.
    // This prevents accidentally burning tokens by re-executing in a terminal workspace.
    if (!confirmedTerminalSend.current && isTerminalOutcome(activeWorkspaceOutcome)) {
      const hasExistingSession = task?.sessionId;
      // For tasks with an existing session, the agent resumes context-aware.
      // For new chats (no task or draft tab), the agent starts fresh — warn first.
      if (!hasExistingSession) {
        setPendingTerminalSend(true);
        return;
      }
    }
    confirmedTerminalSend.current = false;

    if (!task) {
      const sshConnected = useUiStore.getState().sshConnected;
      if (!sshConnected) {
        const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;
        const activeWorkspace = activeWorkspaceId
          ? useWorkspaceStore.getState().workspaces.get(activeWorkspaceId)
          : undefined;
        try {
          if (activeWorkspace) {
            await startWorkspaceChat({
              workspace: activeWorkspace,
              prompt: text,
              agentId: selectedAgentId,
              model: selectedModel,
              mode,
              thinking: selectedThinking,
              images: images.length > 0 ? images : undefined,
              attachments,
            });
          } else {
            await createWorkspaceAndChat(text, {
              agentId: selectedAgentId,
              model: selectedModel,
              mode,
              thinking: selectedThinking,
              cwd: cwd || '.',
              images: images.length > 0 ? images : undefined,
              attachments,
            });
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to create workspace');
        }
        setValue('');
        setImages([]);
        setAttachedFiles([]);
        return;
      }
      // SSH fallback: standalone task (no worktree support over SSH)
      const taskId = crypto.randomUUID();
      createTask({
        id: taskId,
        title: text.slice(0, 80),
        agentId: selectedAgentId,
        model: selectedModel,
        mode,
        thinking: selectedThinking,
        cwd: cwd || '.',
      });
      task = useChatStore.getState().tasks.get(taskId)!;
    }

    // Draft workspace tabs (created before first send) should bootstrap via workspace:spawn-chat
    // so first-message branch/worktree renaming and workspace session setup run consistently.
    if (task.workspaceId && !task.sessionId) {
      const workspace = useWorkspaceStore.getState().workspaces.get(task.workspaceId);
      if (workspace) {
        try {
          await startWorkspaceChat({
            taskId: task.id,
            workspace,
            prompt: text,
            agentId: selectedAgentId,
            model: selectedModel,
            mode: useUiStore.getState().mode,
            thinking: selectedThinking,
            images: images.length > 0 ? images : undefined,
            attachments,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to start workspace chat');
        }
        setValue('');
        setImages([]);
        setAttachedFiles([]);
        return;
      }
    }

    const pendingQuestion = task.pendingQuestion;
    const isAnsweringQuestion = !!pendingQuestion;

    if (!isAnsweringQuestion) {
      addUserMessage(task.id, text, images.length > 0 ? images : undefined, attachments);
    }

    try {
      const hasActiveRun = task.status === 'running' || task.status === 'waiting_approval' || task.status === 'waiting_input';
      if (isAnsweringQuestion) {
        useChatStore.getState().setPendingQuestion(task.id, null);
        setTaskStatus(task.id, 'running');
        await window.api.invoke('task:answer-question', {
          taskId: task.id,
          requestId: pendingQuestion.requestId,
          response: text,
        });
      } else if (!hasActiveRun) {
        const currentMode = useUiStore.getState().mode;
        if (task.mode !== currentMode) {
          setTaskMode(task.id, currentMode);
        }
        // Sync agent/model selection to the task (user may have changed the selector)
        if (task.agentId !== selectedAgentId || task.model !== selectedModel) {
          useChatStore.getState().switchTaskAgent(task.id, selectedAgentId, selectedModel);
        }
        setTaskStatus(task.id, 'running');
        const result = await window.api.invoke('task:spawn', {
          taskId: task.id,
          workspaceId: task.workspaceId,
          prompt: text,
          agentId: selectedAgentId,
          model: selectedModel,
          mode: currentMode,
          thinking: task.thinking,
          cwd: task.cwd,
          sessionId: task.sessionId,
          images: images.length > 0 ? images : undefined,
          attachments,
        }) as { session?: Session };
        if (result?.session) {
          setTaskSessionId(task.id, result.session.id);
          upsertSession(result.session);
        }
      } else {
        setTaskStatus(task.id, 'running');
        const steerResult = await window.api.invoke('task:steer', {
          taskId: task.id,
          prompt: text,
          images: images.length > 0 ? images : undefined,
          attachments,
        }) as { steerFailed?: boolean };

        if (steerResult?.steerFailed) {
          // Task already finished between UI check and IPC call — fall back to spawn
          const currentMode = useUiStore.getState().mode;
          if (task.mode !== currentMode) {
            setTaskMode(task.id, currentMode);
          }
          if (task.agentId !== selectedAgentId || task.model !== selectedModel) {
            useChatStore.getState().switchTaskAgent(task.id, selectedAgentId, selectedModel);
          }
          const spawnResult = await window.api.invoke('task:spawn', {
            taskId: task.id,
            workspaceId: task.workspaceId,
            prompt: text,
            agentId: selectedAgentId,
            model: selectedModel,
            mode: currentMode,
            thinking: task.thinking,
            cwd: task.cwd,
            sessionId: task.sessionId,
            images: images.length > 0 ? images : undefined,
            attachments,
          }) as { session?: Session };
          if (spawnResult?.session) {
            setTaskSessionId(task.id, spawnResult.session.id);
            upsertSession(spawnResult.session);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start task';
      if (isAnsweringQuestion) {
        useChatStore.getState().setPendingQuestion(task.id, pendingQuestion ?? null);
        setTaskStatus(task.id, 'waiting_input');
      } else {
        setTaskStatus(task.id, 'error');
      }
      toast.error(message);
    }

    setValue('');
    setImages([]);
    setAttachedFiles([]);
  }, [value, images, attachedFiles, getActiveTask, createTask, addUserMessage, selectedAgentId, selectedModel, selectedThinking, mode, setTaskStatus, setTaskSessionId, upsertSession, isTerminal, cwd, shellHistory]);

  const handleStop = useCallback(async () => {
    const task = getActiveTask();
    if (!task) return;
    const isActive = task.status === 'running' || task.status === 'waiting_approval' || task.status === 'waiting_input';
    if (!isActive) return;
    try {
      await window.api.invoke('task:stop', { taskId: task.id });
    } catch {
      // agent:done event handles status transition
    }
  }, [getActiveTask]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ghost text: Tab accepts, Escape dismisses
    if (isTerminal && ghostText) {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        setValue((v) => v + ghostText);
        setGhostText('');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setGhostText('');
        return;
      }
    }

    if (e.key === 'Escape') {
      const task = getActiveTask();
      if (task && (task.status === 'running' || task.status === 'waiting_approval' || task.status === 'waiting_input')) {
        e.preventDefault();
        void handleStop();
        return;
      }
    }

    // Shell history: Up/Down in terminal mode
    if (isTerminal) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = historyIndex.current + 1;
        if (next < shellHistory.length) {
          historyIndex.current = next;
          setValue(`$ ${shellHistory[next]}`);
          setGhostText('');
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = historyIndex.current - 1;
        if (next < 0) {
          historyIndex.current = -1;
          setValue('$ ');
        } else {
          historyIndex.current = next;
          setValue(`$ ${shellHistory[next]}`);
        }
        setGhostText('');
        return;
      }
    }

    if (showSlash || showMention) return;

    // Shift+Tab toggles plan/act mode (chat mode only)
    if (!isTerminal && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      useUiStore.getState().toggleMode();
      return;
    }

    const shouldSend =
      sendKey === 'enter'
        ? e.key === 'Enter' && !e.shiftKey
        : (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    if (shouldSend) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;

    // Guard: in terminal mode keep '$ ' prefix
    if (isTerminal) {
      if (!v.startsWith('$ ')) {
        setValue('$ ');
        setGhostText('');
        return;
      }
      setValue(v);
      historyIndex.current = -1;
      setGhostText('');
      scheduleCompletion(v.slice(2)); // pass command part only
      return;
    }

    setValue(v);

    // Auto-switch to terminal mode when user types '$ '
    if (v === '$ ' || v.startsWith('$ ')) {
      useUiStore.getState().setInputMode('terminal');
      return;
    }

    if (v.startsWith('/')) {
      setShowSlash(true);
      setSlashQuery(v.slice(1));
      setShowMention(false);
    } else {
      setShowSlash(false);
      setSlashQuery('');
    }

    // Check for @mention
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = v.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);
    if (atMatch) {
      setShowMention(true);
      setMentionQuery(atMatch[1]);
    } else {
      setShowMention(false);
      setMentionQuery('');
    }
  };

  const handleMentionSelect = useCallback((filePath: string, fileName: string) => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === filePath)) return prev;
      return [...prev, { path: filePath, name: fileName }];
    });

    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const textAfterCursor = value.slice(cursorPos);
    const replaced = textBeforeCursor.replace(/@\S*$/, `@${fileName} `);
    setValue(replaced + textAfterCursor);

    setShowMention(false);
    setMentionQuery('');
    textareaRef.current?.focus();
  }, [value]);

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setImages((prev) => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }

    e.target.value = '';
  };

  const handleSlashSelect = (command: string) => {
    setValue('');
    setShowSlash(false);
    setSlashQuery('');

    const ui = useUiStore.getState();
    const activeTaskForSlash = getActiveTask();
    switch (command) {
      case '/plan':
        ui.setMode('plan');
        if (activeTaskForSlash) setTaskMode(activeTaskForSlash.id, 'plan');
        break;
      case '/act':
        ui.setMode('act');
        if (activeTaskForSlash) setTaskMode(activeTaskForSlash.id, 'act');
        break;
      case '/shell':
        ui.setInputMode('terminal');
        break;
      case '/agent':
        ui.setOverlay('agent-selector');
        break;
      case '/session':
        ui.setOverlay('session-picker');
        break;
      case '/settings':
        ui.setOverlay('settings');
        break;
      case '/clear': {
        const task = getActiveTask();
        if (task) {
          useChatStore.getState().removeTask(task.id);
        }
        break;
      }
    }
  };

  const handleSlashClose = () => {
    setShowSlash(false);
    setSlashQuery('');
  };

  const handleCycleThinking = useCallback(() => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh'];
    const current = useAgentStore.getState().selectedThinking;
    const idx = levels.indexOf(current);
    useAgentStore.getState().setSelectedThinking(levels[(idx + 1) % levels.length]);
  }, []);

  const handleToggleInputMode = useCallback(() => {
    useUiStore.getState().toggleInputMode();
  }, []);

  const hasActiveRun = !!activeTask && (
    activeTask.status === 'running' ||
    activeTask.status === 'waiting_approval' ||
    activeTask.status === 'waiting_input'
  );
  const canSpawnSubagents = hasActiveRun;
  const pendingQuestion = activeTask?.pendingQuestion;
  const placeholder = isTerminal
    ? 'Run a command...'
    : pendingQuestion
    ? pendingQuestion.placeholder ?? pendingQuestion.prompt
    : 'Ask to make changes, @mention files, run /commands';

  const hasContent = isTerminal ? value.trim().length > 2 : value.trim().length > 0;

  useEffect(() => {
    if (!showSubagentDialog) return;
    window.api.invoke('config:get').then((config) => {
      const typed = config as FluxConfig;
      setSubagentModel(typed.subagentModel?.trim() || 'haiku');
    }).catch(() => {});
  }, [showSubagentDialog]);

  const handleSpawnSubagents = useCallback(async () => {
    if (!activeTask || !canSpawnSubagents) {
      toast.error('Start a task before spawning subagents');
      return;
    }

    const drafts = subagentDrafts
      .map((draft) => ({ name: draft.name.trim(), prompt: draft.prompt.trim() }))
      .filter((draft) => draft.name.length > 0 && draft.prompt.length > 0)
      .slice(0, 5);

    if (drafts.length === 0) {
      toast.error('Add at least one subagent prompt');
      return;
    }

    try {
      await Promise.all(drafts.map((draft) => (
        window.api.invoke('subagent:spawn', {
          parentTaskId: activeTask.id,
          name: draft.name,
          prompt: draft.prompt,
          model: subagentModel.trim() || undefined,
          cwd: activeTask.cwd,
        })
      )));
      setShowSubagentDialog(false);
      setSubagentDrafts([{ name: 'Explore', prompt: '' }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to spawn subagents');
    }
  }, [activeTask, canSpawnSubagents, subagentDrafts, subagentModel]);

  const isContinuing = !isTerminal && !isTerminalOutcome(activeWorkspaceOutcome) && activeTask && (activeTask.status === 'done' || activeTask.status === 'error') && activeTask.messages.length > 0;
  const isModeSwitch = isContinuing && activeTask.mode !== mode;

  const displayModel = (() => {
    const model = dynamicModels.find((item) => item.id === selectedModel);
    if (model) return model.name;
    return selectedModel
      .replace('claude-', '')
      .replace('gpt-', 'GPT-');
  })();
  const supportsThinking = currentAgent?.supportsThinking ?? true;

  // Container border/bg classes for terminal mode (Warp-style)
  const shellClasses = isTerminal
    ? 'border-l-2 border-l-green-500/70 border-t border-r border-b border-border/80 bg-green-950/10'
    : 'border border-border/70';

  return (
    <div className="relative w-full">
      {isContinuing && (
        <div className="mb-1 flex items-center gap-2 px-0.5">
          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
            <RotateCcw size={11} />
            Continuing conversation
          </span>
          {isModeSwitch && (
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
              mode === 'plan'
                ? 'border border-plan/20 bg-plan/12 text-plan'
                : 'border border-accent/20 bg-accent/12 text-accent'
            }`}>
              switching to {mode} mode
            </span>
          )}
        </div>
      )}

      {showSlash && (
        <SlashMenu
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />
      )}

      {showMention && (
        <FileMention
          query={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => setShowMention(false)}
        />
      )}

      {/* Confirmation banner for sending in a completed/merged workspace */}
      {pendingTerminalSend && (
        <div className="mb-1.5 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2">
          <span className="text-xs text-warning">
            This workspace is already completed. Start a new agent run?
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPendingTerminalSend(false)}
              className="rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setPendingTerminalSend(false);
                confirmedTerminalSend.current = true;
                handleSend();
              }}
              className="rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/25"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      <div className={`premium-input-shell px-3 py-2.5 transition-colors ${shellClasses}`}>
        {/* Terminal mode badge */}
        {isTerminal && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
              <Terminal size={10} />
              Terminal
            </span>
            <span className="text-[10px] text-text-tertiary">Tab to complete · ↑↓ history · Esc to dismiss</span>
          </div>
        )}

        {showSubagentDialog && (
          <div className="premium-panel mb-2 space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-primary">Spawn subagents</p>
                <p className="text-xs text-text-tertiary">Parallel plan-mode agents for the active run.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubagentDialog(false)}
                className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
                title="Close subagent panel"
                aria-label="Close subagent panel"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-text-tertiary">Model</label>
              <input
                type="text"
                value={subagentModel}
                onChange={(e) => setSubagentModel(e.target.value)}
                className="premium-focus flex-1 rounded-md border border-border bg-bg-elevated/75 px-3 py-2 text-sm text-text-primary outline-none"
                placeholder="haiku"
              />
            </div>

            <div className="space-y-2">
              {subagentDrafts.map((draft, index) => (
                <div key={index} className="premium-panel space-y-2 px-3 py-2.5">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))}
                    className="premium-focus w-full rounded-md border border-border bg-bg-primary/80 px-3 py-2 text-sm text-text-primary outline-none"
                    placeholder="Agent name"
                  />
                  <textarea
                    value={draft.prompt}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: e.target.value } : item))}
                    className="premium-focus min-h-20 w-full resize-y rounded-md border border-border bg-bg-primary/80 px-3 py-2 text-sm text-text-primary outline-none"
                    placeholder="What should this subagent explore?"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSubagentDrafts((current) => current.length >= 5 ? current : [...current, { name: `Explore ${current.length + 1}`, prompt: '' }])}
                className="premium-toolbar-button inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-text-tertiary"
              >
                <Plus size={12} />
                Add agent
              </button>
              <button
                type="button"
                onClick={() => void handleSpawnSubagents()}
                className="rounded-md bg-success px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                disabled={!canSpawnSubagents}
              >
                Spawn
              </button>
            </div>
          </div>
        )}

        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {attachedFiles.map((file) => (
              <span
                key={file.path}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-bg-elevated/50 px-2 py-0.5 text-xs text-text-secondary"
              >
                @{file.name}
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((f) => f.path !== file.path))}
                  className="premium-toolbar-button rounded-sm p-0.5 text-text-tertiary"
                  title={`Remove ${file.name}`}
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Textarea with ghost text overlay */}
        <div className="relative">
          {/* Ghost text overlay (terminal mode only) */}
          {isTerminal && ghostText && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 w-full resize-none text-[14px] leading-5 outline-none font-mono whitespace-pre-wrap break-words p-[1px]"
              style={{ minHeight: 60, maxHeight: 160, overflow: 'hidden' }}
            >
              <span className="invisible">{value}</span>
              <span className="text-text-tertiary/50">{ghostText}</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={2}
            autoFocus
            className={`chat-input-textarea w-full resize-none bg-transparent text-[14px] leading-5 text-text-primary placeholder:text-text-tertiary outline-none ${isTerminal ? 'font-mono' : ''}`}
            style={{ minHeight: 60, maxHeight: 160 }}
          />
        </div>

        <ImageAttach
          images={images}
          onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
        />

        {/* Toolbar below textarea */}
        <div className="mt-1.5">
          <div className="flex items-center justify-between gap-3">
            {/* Left controls */}
            <div className="relative flex items-center gap-1">
              {!isTerminal && (
                <>
                  {/* Model selector button */}
                  <button
                    type="button"
                    onClick={() => setShowModelSelector((v) => !v)}
                    className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-text-secondary"
                    title={`Select model (${isMac ? 'Cmd' : 'Ctrl'}+Shift+M)`}
                  >
                    <AgentIcon
                      agentId={selectedAgentId}
                      size={13}
                      className={AGENT_COLORS[selectedAgentId] ?? 'text-text-tertiary'}
                    />
                    <span className="max-w-[160px] truncate">{displayModel}</span>
                  </button>

                  <ModelSelectorDropdown
                    open={showModelSelector}
                    onClose={() => setShowModelSelector(false)}
                  />

                  {/* Thinking toggle */}
                  {supportsThinking && (
                    <button
                      type="button"
                      onClick={handleCycleThinking}
                      className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated/50 px-2.5 py-1 text-xs text-text-secondary"
                      title={`Thinking: ${THINKING_LABELS[selectedThinking]} (${isMac ? 'Cmd' : 'Ctrl'}+Shift+T)`}
                    >
                      <Brain size={12} className="text-text-secondary" />
                      <span className="text-text-primary font-medium">{THINKING_LABELS[selectedThinking]}</span>
                    </button>
                  )}

                  {/* Plan / Act mode toggle */}
                  <button
                    type="button"
                    onClick={() => useUiStore.getState().toggleMode()}
                    className={`premium-toolbar-button inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                      mode === 'plan'
                        ? 'border border-plan/20 bg-plan/10 text-plan'
                        : 'text-text-secondary'
                    }`}
                    title={`${mode === 'plan' ? 'Plan' : 'Act'} mode (Shift+Tab to toggle)`}
                  >
                    <BookOpen size={12} />
                    {mode === 'plan' && <span>Plan</span>}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!showRateLimits) {
                          void refreshRateLimits();
                        }
                        setShowRateLimits((open) => !open);
                      }}
                      className={`premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${
                        highestSeverity === 'rejected'
                          ? 'border-error/40 bg-error/10 text-error'
                          : highestSeverity === 'allowed_warning'
                            ? 'border-warning/35 bg-warning/10 text-warning'
                            : highestSeverity === 'allowed'
                              ? 'border-success/25 bg-success/10 text-success'
                              : 'border-border/60 bg-bg-elevated/50 text-text-secondary'
                      }`}
                      title="Peek rate limits"
                      aria-label="Peek rate limits"
                    >
                      <Gauge size={12} />
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          highestSeverity === 'rejected'
                            ? 'bg-error'
                            : highestSeverity === 'allowed_warning'
                              ? 'bg-warning'
                              : highestSeverity === 'allowed'
                                ? 'bg-success'
                                : 'bg-text-tertiary/50'
                        }`}
                      />
                    </button>

                    {showRateLimits && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowRateLimits(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-1 w-[280px] rounded-lg border border-border/80 bg-bg-elevated p-2.5 shadow-xl">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                              Rate Limits
                            </p>
                            <button
                              type="button"
                              onClick={() => void refreshRateLimits()}
                              className="rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                              title="Refresh rate limits"
                              aria-label="Refresh rate limits"
                            >
                              <RefreshCw size={11} />
                            </button>
                          </div>

                          {visibleRateLimits.length === 0 ? (
                            <p className="py-2 text-[11px] text-text-tertiary">No rate limit data yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {visibleRateLimits.map((entry) => (
                                <div
                                  key={`${entry.providerId}:${entry.rateLimitType}`}
                                  className="rounded-md border border-border/60 bg-bg-primary/55 px-2 py-1.5"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="truncate text-[11px] font-medium text-text-primary">
                                      {providerLabel(entry.providerId)}
                                    </p>
                                    <span className={`text-[11px] font-semibold tabular-nums ${rateLimitTextColor(entry)}`}>
                                      {Math.round(Math.max(0, Math.min(1, entry.utilization)) * 100)}%
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
                                    <span className="truncate">{entry.rateLimitType.replace(/[_-]+/g, ' ')}</span>
                                    <span>
                                      {entry.resetsAt > 0 ? `resets in ${formatTimeUntil(entry.resetsAt)}` : 'no reset'}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-[10px] text-text-tertiary">
                              {rateLimitsUpdatedAt ? `Updated ${formatRelativeTime(rateLimitsUpdatedAt)}` : 'Not refreshed yet'}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                useUiStore.getState().setSidebarOpen(true);
                                useUiStore.getState().setSidebarTab('usage');
                                setShowRateLimits(false);
                              }}
                              className="rounded px-1.5 py-1 text-[10px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            >
                              Open usage
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {isTerminal && (
                /* Completion model picker in terminal mode */
                <div className="relative flex items-center gap-1.5">
                  <span className="text-[10px] text-text-tertiary">AI complete:</span>
                  <button
                    type="button"
                    onClick={() => setShowCompletionPicker((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] outline-none transition-colors ${
                      completionProviders.length === 0
                        ? 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        : 'border-border/60 bg-bg-elevated/60 text-text-secondary hover:bg-bg-elevated/90'
                    }`}
                  >
                    <span>{completionProviders.length === 0 ? 'no key' : completionModel}</span>
                    <ChevronDown size={10} className="text-text-tertiary" />
                  </button>

                  {showCompletionPicker && (
                    <>
                      {/* backdrop */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowCompletionPicker(false)} />
                      <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded-lg border border-border/80 bg-bg-elevated shadow-xl">
                        <div className="p-1.5">
                          {completionProviders.includes('anthropic') && (
                            <div>
                              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary/60">Claude</div>
                              {[
                                { id: 'haiku', label: 'Haiku 4.5', desc: 'Fastest' },
                                { id: 'sonnet', label: 'Sonnet 4.6', desc: 'Balanced' },
                              ].map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => { useUiStore.getState().setCompletionModel(m.id); setShowCompletionPicker(false); }}
                                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                                    completionModel === m.id ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover'
                                  }`}
                                >
                                  <span>{m.label}</span>
                                  <span className="text-[9px] text-text-tertiary">{m.desc}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {completionProviders.includes('openai') && (
                            <div>
                              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary/60 mt-1">OpenAI</div>
                              {[
                                { id: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Fast' },
                                { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', desc: 'Fast' },
                                { id: 'o4-mini', label: 'o4-mini', desc: 'Reasoning' },
                              ].map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => { useUiStore.getState().setCompletionModel(m.id); setShowCompletionPicker(false); }}
                                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                                    completionModel === m.id ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover'
                                  }`}
                                >
                                  <span>{m.label}</span>
                                  <span className="text-[9px] text-text-tertiary">{m.desc}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {completionProviders.includes('google') && (
                            <div>
                              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary/60 mt-1">Gemini</div>
                              {[
                                { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Fast' },
                                { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', desc: 'Fast' },
                              ].map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => { useUiStore.getState().setCompletionModel(m.id); setShowCompletionPicker(false); }}
                                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                                    completionModel === m.id ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-hover'
                                  }`}
                                >
                                  <span>{m.label}</span>
                                  <span className="text-[9px] text-text-tertiary">{m.desc}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {completionProviders.length === 0 && (
                            <div className="px-2 py-2 text-[11px] text-text-tertiary">
                              No API keys configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5">
              {/* Subagent button (chat mode only) */}
              {!isTerminal && (
                <button
                  type="button"
                  onClick={() => setShowSubagentDialog((v) => !v)}
                  className="premium-toolbar-button rounded-full p-1.5 text-text-tertiary disabled:opacity-40"
                  aria-label="More options"
                  disabled={!canSpawnSubagents}
                  title={canSpawnSubagents ? 'Spawn subagents' : 'Start a task first'}
                >
                  <Plus size={14} />
                </button>
              )}

              {/* Stop button (when agent is running, chat mode only) */}
              {hasActiveRun && !isTerminal ? (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  className="flex-shrink-0 rounded-full p-2.5 transition-colors bg-red-600 hover:bg-red-500 text-white"
                  aria-label="Stop agent"
                  title="Stop agent (Escape)"
                >
                  <Square size={14} fill="currentColor" strokeWidth={0} />
                </button>
              ) : (
                /* Send button (circular) */
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!hasContent}
                  className={`flex-shrink-0 rounded-full p-2.5 transition-colors ${
                    hasContent
                      ? isTerminal
                        ? 'bg-green-600 text-white'
                        : mode === 'plan'
                        ? 'bg-plan text-bg-primary'
                        : 'bg-success text-white'
                      : 'bg-bg-hover text-text-tertiary cursor-not-allowed'
                  }`}
                  aria-label="Send message"
                  title="Send message"
                >
                  <ArrowUp size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilePicked}
        className="hidden"
      />
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
