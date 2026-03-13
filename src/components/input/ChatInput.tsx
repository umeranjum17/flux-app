import { useRef, useState, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react';
import { ArrowUp, Paperclip, Users2, Plus, X, RotateCcw, Brain, Map, ClipboardList, Zap, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { ImageAttach } from './ImageAttach';
import { SlashMenu } from './SlashMenu';
import { FileMention } from './FileMention';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import type { FluxConfig, Session } from '../../lib/ipc-api';
import type { AgentId, FileAttachment, ThinkingLevel } from '../../lib/types';

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

  const { getActiveTask, createTask, addUserMessage, setTaskStatus, setTaskSessionId, setTaskMode } = useChatStore();
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore();
  const { mode, sendKey } = useUiStore();
  const pendingMention = useUiStore((s) => s.pendingMention);

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
        cwd: useUiStore.getState().cwd || '.',
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
        await window.api.invoke('task:steer', {
          taskId: task.id,
          prompt: text,
          images: images.length > 0 ? images : undefined,
          attachments,
        });
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
  }, [value, images, attachedFiles, getActiveTask, createTask, addUserMessage, selectedAgentId, selectedModel, selectedThinking, mode, setTaskStatus, setTaskSessionId, upsertSession]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash || showMention) return;

    // Shift+Tab toggles plan/act mode
    if (e.key === 'Tab' && e.shiftKey) {
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
    setValue(v);

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

  const activeTask = getActiveTask();
  const canSpawnSubagents = !!activeTask && (activeTask.status === 'running' || activeTask.status === 'waiting_approval' || activeTask.status === 'waiting_input');
  const pendingQuestion = activeTask?.pendingQuestion;
  const placeholder = pendingQuestion
    ? pendingQuestion.placeholder ?? pendingQuestion.prompt
    : 'Ask Flux anything... (@ to mention files)';

  const hasContent = value.trim().length > 0;

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

  const isContinuing = activeTask && (activeTask.status === 'done' || activeTask.status === 'error') && activeTask.messages.length > 0;
  const isModeSwitch = isContinuing && activeTask.mode !== mode;

  // Display model name (shorten common prefixes)
  const displayModel = selectedModel
    .replace('claude-', '')
    .replace('gpt-', 'GPT-');

  return (
    <div className="relative w-full">
      {isContinuing && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
            <RotateCcw size={11} />
            Continuing conversation
          </span>
          {isModeSwitch && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">
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

      <div className="bg-bg-surface border border-border-subtle rounded-xl p-3">
        {showSubagentDialog && (
          <div className="mb-3 space-y-3 rounded-lg border border-border bg-bg-primary/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-primary">Spawn subagents</p>
                <p className="text-xs text-text-tertiary">Parallel plan-mode agents for the active run.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubagentDialog(false)}
                className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
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
                className="flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary outline-none"
                placeholder="haiku"
              />
            </div>

            <div className="space-y-2">
              {subagentDrafts.map((draft, index) => (
                <div key={index} className="space-y-2 rounded-md border border-border/70 bg-bg-elevated px-3 py-2">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: e.target.value } : item))}
                    className="w-full rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary outline-none"
                    placeholder="Agent name"
                  />
                  <textarea
                    value={draft.prompt}
                    onChange={(e) => setSubagentDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: e.target.value } : item))}
                    className="min-h-20 w-full resize-y rounded-md border border-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary outline-none"
                    placeholder="What should this subagent explore?"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSubagentDrafts((current) => current.length >= 5 ? current : [...current, { name: `Explore ${current.length + 1}`, prompt: '' }])}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
              >
                <Plus size={12} />
                Add agent
              </button>
              <button
                type="button"
                onClick={() => void handleSpawnSubagents()}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                disabled={!canSpawnSubagents}
              >
                Spawn
              </button>
            </div>
          </div>
        )}

        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map((file) => (
              <span
                key={file.path}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs"
              >
                @{file.name}
                <button
                  onClick={() => setAttachedFiles((prev) => prev.filter((f) => f.path !== file.path))}
                  className="p-0.5 rounded hover:bg-accent/20 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={1}
          autoFocus
          className="w-full bg-transparent text-text-primary placeholder:text-text-tertiary resize-none outline-none text-[13px] leading-[22px]"
          style={{ maxHeight: 192 }}
        />

        <ImageAttach
          images={images}
          onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
        />

        {/* Toolbar below textarea */}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-border-subtle/50">
          {/* Left controls */}
          <div className="relative flex items-center gap-1">
            {/* Model selector button */}
            <button
              type="button"
              onClick={() => setShowModelSelector((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors"
              title={`Select model (${isMac ? 'Cmd' : 'Ctrl'}+Shift+M)`}
            >
              <Sparkles size={12} className="text-text-tertiary" />
              {displayModel}
            </button>

            <ModelSelectorDropdown
              open={showModelSelector}
              onClose={() => setShowModelSelector(false)}
            />

            {/* Thinking toggle */}
            <button
              type="button"
              onClick={handleCycleThinking}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-bg-hover transition-colors"
              title={`Thinking: ${THINKING_LABELS[selectedThinking]} (${isMac ? 'Cmd' : 'Ctrl'}+Shift+T)`}
            >
              <Brain size={12} className="text-accent" />
              <span className="text-accent font-medium">{THINKING_LABELS[selectedThinking]}</span>
            </button>

            {/* Plan mode icon */}
            <button
              type="button"
              onClick={() => useUiStore.getState().toggleMode()}
              className={`p-1.5 rounded-md transition-colors ${
                mode === 'plan'
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
              }`}
              title={`${mode === 'plan' ? 'Disable' : 'Enable'} plan mode (Shift+Tab)`}
            >
              <Map size={14} />
            </button>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {/* Plan / Act segmented toggle */}
            <div className="flex items-center rounded-md bg-bg-primary/60 text-[11px] font-medium overflow-hidden border border-border-subtle">
              <button
                type="button"
                onClick={() => {
                  useUiStore.getState().setMode('plan');
                  const t = getActiveTask();
                  if (t) setTaskMode(t.id, 'plan');
                }}
                className={`flex items-center gap-1 px-2.5 py-[3px] transition-all ${
                  mode === 'plan'
                    ? 'bg-accent text-white'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <ClipboardList size={11} />
                Plan
              </button>
              <button
                type="button"
                onClick={() => {
                  useUiStore.getState().setMode('act');
                  const t = getActiveTask();
                  if (t) setTaskMode(t.id, 'act');
                }}
                className={`flex items-center gap-1 px-2.5 py-[3px] transition-all ${
                  mode === 'act'
                    ? 'bg-success text-white'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Zap size={11} />
                Act
              </button>
            </div>

            {/* Attach / subagent button */}
            <button
              type="button"
              onClick={handleFileSelect}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
              aria-label="Attach file"
              title="Attach image"
            >
              <Paperclip size={14} />
            </button>

            {/* + button (subagents) */}
            <button
              type="button"
              onClick={() => setShowSubagentDialog((v) => !v)}
              className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-40"
              aria-label="More options"
              disabled={!canSpawnSubagents}
              title={canSpawnSubagents ? 'Spawn subagents' : 'Start a task first'}
            >
              <Plus size={14} />
            </button>

            {/* Send button (circular) */}
            <button
              type="button"
              onClick={handleSend}
              disabled={!hasContent}
              className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
                hasContent
                  ? mode === 'plan'
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'bg-text-primary text-bg-primary hover:opacity-90'
                  : 'bg-bg-hover text-text-tertiary cursor-not-allowed'
              }`}
              aria-label="Send message"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
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
