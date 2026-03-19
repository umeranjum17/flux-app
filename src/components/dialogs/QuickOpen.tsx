import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, Search } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

interface FileEntry {
  path: string;
  name: string;
}

function fuzzyMatch(query: string, target: string): boolean {
  const lower = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < query.length; i++) {
    if (lower[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function QuickOpen() {
  const { activeOverlay, setOverlay, setActiveFile, cwd } = useUiStore();
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const open = activeOverlay === 'quick-open';

  // Fetch file list on open
  useEffect(() => {
    if (!open || !cwd) return;
    let cancelled = false;
    setLoading(true);
    window.api.invoke('fs:glob', { cwd }).then((result) => {
      if (!cancelled) {
        setFiles(result as FileEntry[]);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, cwd]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      setFiles([]);
    }
  }, [open]);

  // Filter files based on query
  const lower = query.toLowerCase();
  const filtered = query
    ? files.filter((f) => fuzzyMatch(lower, f.path)).slice(0, 100)
    : files.slice(0, 100);

  // Reset active index when query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectFile = useCallback(
    (file: FileEntry) => {
      setActiveFile({ path: file.path, name: file.name });
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
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          selectFile(filtered[activeIndex]);
        }
      }
    },
    [open, filtered, activeIndex, setOverlay, selectFile],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

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
            className="bg-bg-elevated rounded-2xl max-w-lg w-full mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={16} className="text-text-tertiary flex-shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files by name..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
              />
            </div>

            <div ref={listRef} className="py-1 max-h-72 overflow-y-auto">
              {loading && (
                <p className="text-sm text-text-tertiary text-center py-6">Loading files...</p>
              )}

              {!loading && filtered.map((file, index) => {
                const parts = file.path.split('/');
                const fileName = parts.pop() || file.path;
                const dir = parts.join('/');

                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => selectFile(file)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      index === activeIndex
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary'
                    }`}
                  >
                    <File size={14} className="flex-shrink-0 text-text-tertiary" />
                    <span className="flex-1 text-left truncate">
                      <span className="text-text-primary">{fileName}</span>
                      {dir && (
                        <span className="text-text-tertiary ml-2 text-xs">{dir}</span>
                      )}
                    </span>
                  </button>
                );
              })}

              {!loading && filtered.length === 0 && query && (
                <p className="text-sm text-text-tertiary text-center py-6">No matching files.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
