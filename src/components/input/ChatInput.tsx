import { useRef, useState, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react';
import { ArrowUp, Plus, X, RotateCcw, Brain, Terminal, ChevronDown, ClipboardList, Zap, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';
import { ImageAttach } from './ImageAttach';
import { SlashMenu } from './SlashMenu';
import { FileMention } from './FileMention';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import type { FluxConfig, Session } from '../../lib/ipc-api';
import type { FileAttachment, ThinkingLevel } from '../../lib/types';

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

  // Terminal / ghost text state
  const [ghostText, setGhostText] = useState('');
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIndex = useRef(-1);

  const { getActiveTask, createTask, addUserMessage, setTaskStatus, setTaskSessionId, setTaskMode } = useChatStore();
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const { selectedAgentId, selectedModel, selectedThinking, agents, dynamicModels } = useAgentStore();
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

  const isMac = window.api?.platform === 'darwin';

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
    const lineHeight = 24;
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

    if (!task) {
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
        setTaskStatus(task.id, 'running');
        const result = await window.api.invoke('task:spawn', {
          taskId: task.id,
          prompt: text,
          agentId: task.agentId,
          model: task.model,
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
          const spawnResult = await window.api.invoke('task:spawn', {
            taskId: task.id,
            prompt: text,
            agentId: task.agentId,
            model: task.model,
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

  const activeTask = getActiveTask();
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

  const isContinuing = !isTerminal && activeTask && (activeTask.status === 'done' || activeTask.status === 'error') && activeTask.messages.length > 0;
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
    : 'border border-border/80';

  return (
    <div className="relative w-full">
      {isContinuing && (
        <div className="mb-2 flex items-center gap-2 px-1">
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

      <div className={`premium-input-shell px-5 py-4 transition-colors focus-within:border-accent/60 ${shellClasses}`}>
        {/* Terminal mode badge */}
        {isTerminal && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
              <Terminal size={10} />
              Terminal
            </span>
            <span className="text-[10px] text-text-tertiary">Tab to complete · ↑↓ history · Esc to dismiss</span>
          </div>
        )}

        {showSubagentDialog && (
          <div className="premium-panel mb-3 space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-primary">Spawn subagents</p>
                <p className="text-xs text-text-tertiary">Parallel plan-mode agents for the active run.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubagentDialog(false)}
                className="premium-toolbar-button rounded-md p-1.5 text-text-secondary"
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
                className="premium-focus flex-1 rounded-lg border border-border bg-bg-elevated/75 px-3 py-2.5 text-sm text-text-primary outline-none"
                placeholder="haiku"
              />
            </div>

            <div className="space-y-2">
              {subagentDrafts.map((draft, index) => (
                <div key={index} className="premium-panel space-y-2 px-3 py-3">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))}
                    className="premium-focus w-full rounded-lg border border-border bg-bg-primary/80 px-3 py-2.5 text-sm text-text-primary outline-none"
                    placeholder="Agent name"
                  />
                  <textarea
                    value={draft.prompt}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: e.target.value } : item))}
                    className="premium-focus min-h-20 w-full resize-y rounded-lg border border-border bg-bg-primary/80 px-3 py-2.5 text-sm text-text-primary outline-none"
                    placeholder="What should this subagent explore?"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSubagentDrafts((current) => current.length >= 5 ? current : [...current, { name: `Explore ${current.length + 1}`, prompt: '' }])}
                className="premium-toolbar-button inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-text-tertiary"
              >
                <Plus size={12} />
                Add agent
              </button>
              <button
                type="button"
                onClick={() => void handleSpawnSubagents()}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-bg-primary disabled:opacity-50"
                disabled={!canSpawnSubagents}
              >
                Spawn
              </button>
            </div>
          </div>
        )}

        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachedFiles.map((file) => (
              <span
                key={file.path}
                className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent-muted/40 px-2.5 py-1 text-xs text-accent"
              >
                @{file.name}
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((f) => f.path !== file.path))}
                  className="premium-toolbar-button rounded-sm p-0.5 text-accent"
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
              className="pointer-events-none absolute inset-0 w-full resize-none text-[15px] leading-6 outline-none font-mono whitespace-pre-wrap break-words p-[1px]"
              style={{ minHeight: 72, maxHeight: 192, overflow: 'hidden' }}
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
            className={`w-full resize-none bg-transparent text-[15px] leading-6 text-text-primary placeholder:text-text-tertiary outline-none ${isTerminal ? 'font-mono' : ''}`}
            style={{ minHeight: 72, maxHeight: 192 }}
          />
        </div>

        <ImageAttach
          images={images}
          onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
        />

        {/* Toolbar below textarea */}
        <div className="mt-2">
          <div className="flex items-center justify-between gap-3">
            {/* Left controls */}
            <div className="relative flex items-center gap-1.5">
              {!isTerminal && (
                <>
                  {/* Model selector button */}
                  <button
                    type="button"
                    onClick={() => setShowModelSelector((v) => !v)}
                    className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-text-secondary"
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

                  {/* Plan / Act mode toggle */}
                  <button
                    type="button"
                    onClick={() => useUiStore.getState().toggleMode()}
                    className={`premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                      mode === 'plan'
                        ? 'border-plan/25 bg-plan/12 text-plan'
                        : 'border-accent/25 bg-accent/12 text-accent'
                    }`}
                    title={`${mode === 'plan' ? 'Plan' : 'Act'} mode (Shift+Tab to toggle)`}
                  >
                    {mode === 'plan' ? <ClipboardList size={12} /> : <Zap size={12} />}
                    {mode === 'plan' ? 'Plan' : 'Act'}
                  </button>

                  {/* Thinking toggle */}
                  {supportsThinking && (
                    <button
                      type="button"
                      onClick={handleCycleThinking}
                      className="premium-toolbar-button inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-muted/35 px-3 py-1.5 text-xs text-text-secondary"
                      title={`Thinking: ${THINKING_LABELS[selectedThinking]} (${isMac ? 'Cmd' : 'Ctrl'}+Shift+T)`}
                    >
                      <Brain size={12} className="text-accent" />
                      <span className="text-accent font-medium">{THINKING_LABELS[selectedThinking]}</span>
                    </button>
                  )}
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
                  className="premium-toolbar-button rounded-full p-2 text-text-tertiary disabled:opacity-40"
                  aria-label="More options"
                  disabled={!canSpawnSubagents}
                  title={canSpawnSubagents ? 'Spawn subagents' : 'Start a task first'}
                >
                  <Plus size={14} />
                </button>
              )}

              {/* Stop button (when agent is running, non-terminal) */}
              {hasActiveRun && !isTerminal ? (
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  className="flex-shrink-0 rounded-full p-3 transition-colors bg-red-600 hover:bg-red-500 text-white"
                  aria-label="Stop agent"
                  title="Stop agent (Escape)"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                /* Send button (circular) */
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!hasContent}
                  className={`flex-shrink-0 rounded-full p-3 transition-colors ${
                    hasContent
                      ? isTerminal
                        ? 'bg-green-600 text-white'
                        : mode === 'plan'
                        ? 'bg-plan text-bg-primary'
                        : 'bg-accent text-bg-primary'
                      : 'bg-bg-hover text-text-tertiary cursor-not-allowed'
                  }`}
                  aria-label="Send message"
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
