import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, FolderOpen, ChevronRight, ArrowUp, Home, Loader2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export function RemoteFolderPicker() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const open = activeOverlay === 'remote-folder-picker';

  const [currentPath, setCurrentPath] = useState('~');
  const [resolvedPath, setResolvedPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('~');

  const loadDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.invoke('fs:listdirs', { dirPath }) as {
        path: string;
        entries: DirEntry[];
        error: string | null;
      };
      if (result.error) {
        setError(result.error);
      } else {
        setResolvedPath(result.path);
        setPathInput(result.path);
        setEntries(result.entries.filter((e) => e.isDirectory));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to list directory');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      loadDir(currentPath);
    }
  }, [open, currentPath, loadDir]);

  const handleSelect = useCallback(() => {
    const targetPath = resolvedPath || currentPath;
    useUiStore.getState().setCwd(targetPath);
    window.api.invoke('cwd:set', { cwd: targetPath });
    setOverlay(null);
  }, [resolvedPath, currentPath, setOverlay]);

  const handleNavigate = useCallback((dirName: string) => {
    const base = resolvedPath || currentPath;
    const newPath = base.endsWith('/') ? `${base}${dirName}` : `${base}/${dirName}`;
    setCurrentPath(newPath);
  }, [resolvedPath, currentPath]);

  const handleGoUp = useCallback(() => {
    const base = resolvedPath || currentPath;
    const parent = base.split('/').slice(0, -1).join('/') || '/';
    setCurrentPath(parent);
  }, [resolvedPath, currentPath]);

  const handleGoHome = useCallback(() => {
    setCurrentPath('~');
  }, []);

  const handlePathSubmit = useCallback(() => {
    if (pathInput.trim()) {
      setCurrentPath(pathInput.trim());
    }
  }, [pathInput]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOverlay(null); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, setOverlay]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOverlay(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="bg-bg-elevated rounded-2xl w-full max-w-lg mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Open Remote Folder</h2>
              <p className="text-[11px] text-text-tertiary mt-0.5">Browse directories on the remote host</p>
            </div>

            {/* Path input */}
            <div className="px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <button onClick={handleGoHome} className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title="Home">
                  <Home size={14} />
                </button>
                <button onClick={handleGoUp} className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title="Parent directory">
                  <ArrowUp size={14} />
                </button>
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit(); }}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary font-mono placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            {/* Directory listing */}
            <div className="h-[300px] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-text-tertiary" />
                </div>
              )}

              {error && (
                <p className="text-xs text-error px-5 py-4">{error}</p>
              )}

              {!loading && !error && entries.length === 0 && (
                <p className="text-[11px] text-text-tertiary px-5 py-6 text-center">No subdirectories</p>
              )}

              {!loading && entries.map((entry) => (
                <button
                  key={entry.name}
                  onDoubleClick={() => handleNavigate(entry.name)}
                  onClick={() => handleNavigate(entry.name)}
                  className="w-full flex items-center gap-2.5 px-5 py-2 text-left hover:bg-bg-hover transition-colors"
                >
                  <Folder size={14} className="text-accent shrink-0" />
                  <span className="text-xs text-text-primary truncate">{entry.name}</span>
                  <ChevronRight size={12} className="text-text-tertiary ml-auto shrink-0" />
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <span className="text-[11px] text-text-tertiary font-mono truncate max-w-[250px]" title={resolvedPath}>
                {resolvedPath}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOverlay(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSelect}
                  className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 transition-colors"
                >
                  Open
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
