import { useCallback, useRef, useEffect } from 'react';
import { X, ArrowUp, ArrowDown } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminal';
import { searchInTerminal, searchPrevInTerminal, clearSearch } from '../../lib/terminal-manager';

export function TerminalSearchBar() {
  const activeId = useTerminalStore((s) => s.activeId);
  const query = useTerminalStore((s) => s.searchQuery);
  const setQuery = useTerminalStore((s) => s.setSearchQuery);
  const setSearchOpen = useTerminalStore((s) => s.setSearchOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!activeId || !query) return;
    if (direction === 'next') searchInTerminal(activeId, query);
    else searchPrevInTerminal(activeId, query);
  }, [activeId, query]);

  const handleClose = useCallback(() => {
    if (activeId) clearSearch(activeId);
    setSearchOpen(false);
    setQuery('');
  }, [activeId, setSearchOpen, setQuery]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { handleClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch(e.shiftKey ? 'prev' : 'next');
    }
  }, [handleClose, handleSearch]);

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-bg-secondary border-b border-border">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (activeId && e.target.value) searchInTerminal(activeId, e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Find in terminal…"
        className="flex-1 bg-bg-primary border border-border rounded px-2 py-0.5 text-[11px] text-text-primary outline-none focus:border-accent"
      />
      <button onClick={() => handleSearch('prev')} className="p-0.5 text-text-tertiary hover:text-text-primary" title="Previous (Shift+Enter)">
        <ArrowUp size={12} />
      </button>
      <button onClick={() => handleSearch('next')} className="p-0.5 text-text-tertiary hover:text-text-primary" title="Next (Enter)">
        <ArrowDown size={12} />
      </button>
      <button onClick={handleClose} className="p-0.5 text-text-tertiary hover:text-text-primary" title="Close (Escape)">
        <X size={12} />
      </button>
    </div>
  );
}
