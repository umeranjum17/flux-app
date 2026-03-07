import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import {
  ClipboardList,
  Zap,
  Bot,
  FolderOpen,
  Settings,
  Trash2,
} from 'lucide-react';

interface SlashMenuProps {
  query: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

const commands = [
  { name: '/plan', description: 'Switch to plan mode', icon: ClipboardList },
  { name: '/act', description: 'Switch to act mode', icon: Zap },
  { name: '/agent', description: 'Select an agent', icon: Bot },
  { name: '/session', description: 'Open session picker', icon: FolderOpen },
  { name: '/settings', description: 'Open settings', icon: Settings },
  { name: '/clear', description: 'Clear the current conversation', icon: Trash2 },
];

export function SlashMenu({ query, onSelect, onClose }: SlashMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(`/${query.toLowerCase()}`),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          onSelect(filtered[activeIndex].name);
        }
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-50">
      <div className="py-1">
        {filtered.map((cmd, index) => {
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.name}
              type="button"
              onClick={() => onSelect(cmd.name)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                index === activeIndex
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <Icon size={16} className="flex-shrink-0 text-text-tertiary" />
              <span className="font-medium">{cmd.name}</span>
              <span className="text-text-tertiary text-xs ml-auto">{cmd.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
