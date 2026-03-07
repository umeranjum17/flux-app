import { useRef, useState, useCallback, useEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react';
import { SendHorizontal, Paperclip, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAgentStore } from '../../stores/agent';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import { ImageAttach } from './ImageAttach';
import { SlashMenu } from './SlashMenu';
import { FileMention } from './FileMention';
import type { Session } from '../../lib/ipc-api';

interface AttachedFile {
  path: string;
  name: string;
}

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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const { getActiveTask, createTask, addUserMessage, setTaskStatus, setTaskSessionId } = useChatStore();
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const { selectedAgentId, selectedModel, selectedThinking } = useAgentStore();
  const { mode, sendKey } = useUiStore();
  const pendingMention = useUiStore((s) => s.pendingMention);

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

    // Build prompt with file context
    let prompt = text;
    if (attachedFiles.length > 0) {
      const fileContents: string[] = [];
      for (const file of attachedFiles) {
        try {
          const result = await window.api.invoke('fs:read', { filePath: file.path }) as { content: string | null };
          if (result.content) {
            fileContents.push(`--- ${file.name} ---\n${result.content}`);
          }
        } catch {}
      }
      if (fileContents.length > 0) {
        prompt = `${fileContents.join('\n\n')}\n\n${text}`;
      }
    }

    addUserMessage(task.id, text, images.length > 0 ? images : undefined);

    try {
      const hasActiveRun = task.status === 'running' || task.status === 'waiting_approval';
      if (!hasActiveRun) {
        const result = await window.api.invoke('task:spawn', {
          taskId: task.id,
          prompt,
          agentId: task.agentId,
          model: task.model,
          mode: task.mode,
          thinking: task.thinking,
          cwd: task.cwd,
          sessionId: task.sessionId,
          images: images.length > 0 ? images : undefined,
        }) as { session?: Session };
        if (result?.session) {
          setTaskSessionId(task.id, result.session.id);
          upsertSession(result.session);
        }
        setTaskStatus(task.id, 'running');
      } else {
        await window.api.invoke('task:steer', {
          taskId: task.id,
          prompt,
          images: images.length > 0 ? images : undefined,
        });
        setTaskStatus(task.id, 'running');
      }
    } catch {
      setTaskStatus(task.id, 'error');
    }

    setValue('');
    setImages([]);
    setAttachedFiles([]);
  }, [value, images, attachedFiles, getActiveTask, createTask, addUserMessage, selectedAgentId, selectedModel, selectedThinking, mode, setTaskStatus, setTaskSessionId, upsertSession]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash || showMention) return;
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

    // Replace @query with @filename in input
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
    switch (command) {
      case '/plan':
        ui.setMode('plan');
        break;
      case '/act':
        ui.setMode('act');
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

  const hasContent = value.trim().length > 0;

  return (
    <div className="relative w-full">
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

      <div className="bg-bg-elevated border border-border rounded-xl p-4">
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

        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={handleFileSelect}
            className="flex-shrink-0 p-1.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors mb-0.5"
            aria-label="Attach image"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask Flux anything... (@ to mention files)"
            rows={1}
            autoFocus
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-tertiary resize-none outline-none text-sm leading-6"
            style={{ maxHeight: 192 }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={!hasContent}
            className={`flex-shrink-0 p-2 rounded-lg transition-colors mb-0.5 ${
              hasContent
                ? 'bg-accent text-white hover:opacity-90'
                : 'text-text-tertiary cursor-not-allowed'
            }`}
            aria-label="Send message"
          >
            <SendHorizontal size={18} />
          </button>
        </div>

        <ImageAttach
          images={images}
          onRemove={(index) => setImages((prev) => prev.filter((_, i) => i !== index))}
        />
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
