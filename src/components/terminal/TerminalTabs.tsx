import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, X, Terminal, ChevronDown, Trash2, Eraser,
  SquareTerminal,
} from 'lucide-react';

export interface TerminalTab {
  id: string;
  title: string;
  shellName?: string;
  workspaceId?: string;
  workspaceBranch?: string;
}

export interface ShellProfile {
  name: string;
  path: string;
  icon: string;
}

interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeId: string | null;
  profiles: ShellProfile[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: (shell?: string) => void;
  onClear: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export function TerminalTabs({
  tabs, activeId, profiles, onSelect, onClose, onCreate, onClear, onRename,
}: TerminalTabsProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = useCallback((tab: TerminalTab) => {
    setRenamingId(tab.id);
    setRenameValue(tab.title);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRename]);

  return (
    <div className="flex items-center h-[34px] bg-bg-secondary border-b border-border select-none">
      {/* Terminal instance tabs */}
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto px-1 gap-0.5">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeId;
          const isRenaming = renamingId === tab.id;

          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 pl-2 pr-1 h-[26px] rounded text-[11px] cursor-pointer transition-colors shrink-0 ${
                isActive
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/50'
              }`}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => startRename(tab)}
            >
              <SquareTerminal size={12} className={isActive ? 'text-text-secondary' : 'text-text-tertiary'} />

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                  }}
                  className="bg-bg-primary border border-border-focus rounded px-1 py-0 text-[11px] text-text-primary w-[80px] outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[100px]">
                  {tab.title}
                </span>
              )}

              {tab.shellName && !isRenaming && (
                <span className="text-text-tertiary text-[9px] font-mono">
                  {tab.shellName}
                </span>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={`p-0.5 rounded transition-colors shrink-0 ${
                  isActive
                    ? 'text-text-tertiary hover:text-text-primary hover:bg-bg-primary/50'
                    : 'opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary hover:bg-bg-primary/50'
                }`}
                title={`Close ${tab.title}`}
                aria-label={`Close ${tab.title}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Toolbar actions */}
      <div className="flex items-center gap-0.5 px-1.5 shrink-0 border-l border-border/50">
        {/* New terminal with dropdown */}
        <div className="relative" ref={dropdownRef}>
          <div className="flex items-center">
            <button
              onClick={() => onCreate()}
              className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="New Terminal"
              aria-label="New Terminal"
            >
              <Plus size={14} />
            </button>
            {profiles.length > 1 && (
              <button
                onClick={() => setShowDropdown((v) => !v)}
                className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors -ml-0.5"
                title="Select shell profile"
                aria-label="Select shell profile"
              >
                <ChevronDown size={10} />
              </button>
            )}
          </div>

          {/* Shell profile dropdown */}
          {showDropdown && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-bg-elevated border border-border rounded-md shadow-lg py-1">
              <div className="px-2 py-1 text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">
                Shell Profiles
              </div>
              {profiles.map((profile) => (
                <button
                  key={profile.path}
                  onClick={() => { onCreate(profile.path); setShowDropdown(false); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <Terminal size={12} className="text-text-tertiary shrink-0" />
                  <span>{profile.name}</span>
                  <span className="ml-auto text-[9px] text-text-tertiary font-mono truncate max-w-[80px]">
                    {profile.path}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear terminal */}
        {activeId && (
          <button
            onClick={() => activeId && onClear(activeId)}
            className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Clear Terminal"
            aria-label="Clear Terminal"
          >
            <Eraser size={13} />
          </button>
        )}

        {/* Kill terminal */}
        {activeId && (
          <button
            onClick={() => activeId && onClose(activeId)}
            className="p-1 rounded text-text-tertiary hover:text-error hover:bg-error/10 transition-colors"
            title="Kill Terminal"
            aria-label="Kill Terminal"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
