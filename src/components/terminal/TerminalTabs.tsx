import { useState, useCallback, useEffect, useRef } from 'react';
import { Plus, X, SquareTerminal, SplitSquareHorizontal, ChevronDown, Search } from 'lucide-react';
import type { TerminalTab } from '../../stores/terminal';
import { useTerminalStore } from '../../stores/terminal';

interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  onSplit: () => void;
}

export function TerminalTabs({
  tabs, activeId, onSelect, onClose, onCreate, onSplit,
}: TerminalTabsProps) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ name: string; path: string; icon: string }>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const setSearchOpen = useTerminalStore((s) => s.setSearchOpen);
  const searchOpen = useTerminalStore((s) => s.searchOpen);

  // Close menu on outside click
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileMenuOpen]);

  const handleProfileMenuOpen = useCallback(async () => {
    if (profileMenuOpen) { setProfileMenuOpen(false); return; }
    try {
      const result = await window.api.invoke('terminal:get-profiles') as Array<{ name: string; path: string; icon: string }>;
      setProfiles(result);
    } catch { setProfiles([]); }
    setProfileMenuOpen(true);
  }, [profileMenuOpen]);

  const handleProfileSelect = useCallback((shell: string) => {
    setProfileMenuOpen(false);
    useTerminalStore.getState().createTerminal({ shell }).catch(() => {});
  }, []);

  return (
    <div className="flex items-center h-[34px] bg-bg-secondary border-b border-border select-none">
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto px-1 gap-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 pl-2 pr-1 h-[26px] rounded text-[11px] cursor-pointer transition-colors shrink-0 ${
                isActive
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/50'
              }`}
              onClick={() => onSelect(tab.id)}
            >
              <SquareTerminal size={12} className={isActive ? 'text-text-secondary' : 'text-text-tertiary'} />
              <span className="truncate max-w-[140px]" title={tab.cwd ?? tab.title}>
                {tab.cwd ? `${tab.title}: ${tab.cwd.split('/').pop() || tab.cwd}` : tab.title}
              </span>
              {tab.splits && (
                <span className="text-[9px] text-text-tertiary">{tab.splits.length}</span>
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

      <div className="flex items-center px-1.5 shrink-0 border-l border-border/50 gap-0.5">
        <button
          onClick={() => setSearchOpen(!searchOpen)}
          className={`p-1 rounded transition-colors ${
            searchOpen ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
          }`}
          title="Find in Terminal (Ctrl+F)"
          aria-label="Find in Terminal"
        >
          <Search size={13} />
        </button>
        <button
          onClick={onSplit}
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="Split Terminal"
          aria-label="Split Terminal"
        >
          <SplitSquareHorizontal size={13} />
        </button>
        <div className="relative" ref={menuRef}>
          <div className="flex items-center">
            <button
              onClick={onCreate}
              className="p-1 rounded-l text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="New Terminal"
              aria-label="New Terminal"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={handleProfileMenuOpen}
              className="p-0.5 rounded-r text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Select Shell Profile"
              aria-label="Select Shell Profile"
            >
              <ChevronDown size={10} />
            </button>
          </div>

          {profileMenuOpen && profiles.length > 0 && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-border bg-bg-primary shadow-lg py-1">
              {profiles.map((profile) => (
                <button
                  key={profile.path}
                  onClick={() => handleProfileSelect(profile.path)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <span className="text-sm">{profile.icon}</span>
                  <span>{profile.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
