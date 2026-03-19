import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, File } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

interface GrepResult {
  file: string;
  line: number;
  text: string;
}

interface GroupedResult {
  file: string;
  matches: { line: number; text: string }[];
}

function groupByFile(results: GrepResult[]): GroupedResult[] {
  const map = new Map<string, { line: number; text: string }[]>();
  for (const r of results) {
    const existing = map.get(r.file);
    if (existing) {
      existing.push({ line: r.line, text: r.text });
    } else {
      map.set(r.file, [{ line: r.line, text: r.text }]);
    }
  }
  return Array.from(map.entries()).map(([file, matches]) => ({ file, matches }));
}

export function SearchFiles() {
  const { activeOverlay, setOverlay, setActiveFile, cwd } = useUiStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupedResult[]>([]);
  const [flatResults, setFlatResults] = useState<{ file: string; name: string; line: number; text: string }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const open = activeOverlay === 'search-files';

  // Debounced search
  useEffect(() => {
    if (!open || !cwd || !query.trim()) {
      setResults([]);
      setFlatResults([]);
      return;
    }

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const raw = await window.api.invoke('fs:grep', { pattern: query.trim(), cwd }) as GrepResult[];
        const grouped = groupByFile(raw);
        setResults(grouped);

        // Build flat list for keyboard navigation
        const flat: { file: string; name: string; line: number; text: string }[] = [];
        for (const group of grouped) {
          const name = group.file.split('/').pop() || group.file;
          for (const m of group.matches) {
            flat.push({ file: group.file, name, line: m.line, text: m.text });
          }
        }
        setFlatResults(flat);
        setActiveIndex(0);
      } catch {
        setResults([]);
        setFlatResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [open, cwd, query]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setFlatResults([]);
      setActiveIndex(0);
    }
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectResult = useCallback(
    (file: string) => {
      const name = file.split('/').pop() || file;
      setActiveFile({ path: file, name });
      setOverlay(null);
    },
    [setActiveFile, setOverlay],
  );

  const handleKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setOverlay(null);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (flatResults[activeIndex]) {
          selectResult(flatResults[activeIndex].file);
        }
      }
    },
    [open, flatResults, activeIndex, setOverlay, selectResult],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
          onClick={() => setOverlay(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.12 }}
            className="bg-bg-elevated rounded-2xl max-w-xl w-full mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={16} className="text-text-tertiary flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search in files..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
              />
            </div>

            <div ref={listRef} className="py-1 max-h-80 overflow-y-auto">
              {searching && (
                <p className="text-sm text-text-tertiary text-center py-6">Searching...</p>
              )}

              {!searching && results.map((group) => {
                const fileName = group.file.split('/').pop() || group.file;
                const dir = group.file.split('/').slice(0, -1).join('/');

                return (
                  <div key={group.file}>
                    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-text-tertiary bg-bg-secondary/50">
                      <File size={12} className="flex-shrink-0" />
                      <span className="font-medium text-text-secondary">{fileName}</span>
                      {dir && <span className="truncate">{dir}</span>}
                    </div>
                    {group.matches.map((match) => {
                      const idx = flatIdx++;
                      const isActive = idx === activeIndex;
                      return (
                        <button
                          key={`${group.file}:${match.line}`}
                          type="button"
                          data-active={isActive}
                          onClick={() => selectResult(group.file)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={`w-full flex items-center gap-3 px-4 pl-8 py-1.5 text-sm transition-colors ${
                            isActive
                              ? 'bg-bg-hover text-text-primary'
                              : 'text-text-secondary'
                          }`}
                        >
                          <span className="text-text-tertiary text-xs font-mono w-8 text-right flex-shrink-0">
                            {match.line}
                          </span>
                          <span className="flex-1 text-left truncate font-mono text-xs">
                            {match.text.trim()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {!searching && results.length === 0 && query.trim() && (
                <p className="text-sm text-text-tertiary text-center py-6">No results found.</p>
              )}

              {!searching && !query.trim() && (
                <p className="text-sm text-text-tertiary text-center py-6">Type to search across all files...</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
