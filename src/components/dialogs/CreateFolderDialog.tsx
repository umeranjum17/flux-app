import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderPlus, FolderOpen, Loader2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { createRecentProject, rememberRecentProject } from '../../lib/workspace-state';

export function CreateFolderDialog() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const cwd = useUiStore((s) => s.cwd);
  const open = activeOverlay === 'create-folder';

  const [parentPath, setParentPath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setParentPath(cwd || '');
      setFolderName('');
      setInitGit(true);
      setError(null);
    }
  }, [open, cwd]);

  const handleBrowse = useCallback(async () => {
    const picked = await window.api.invoke('fs:pick-directory', { defaultPath: parentPath || undefined }) as string | null;
    if (picked) {
      setParentPath(picked);
      setError(null);
    }
  }, [parentPath]);

  const handleCreate = useCallback(async () => {
    if (!parentPath.trim() || !folderName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await window.api.invoke('cwd:create', {
        parentPath: parentPath.trim(),
        folderName: folderName.trim(),
        initGit,
      }) as { path?: string; error?: string };

      if ('error' in result && result.error) {
        setError(result.error);
        setCreating(false);
        return;
      }

      if (result.path) {
        const uiState = useUiStore.getState();
        uiState.addOpenProject(result.path);
        uiState.setCwd(result.path);
        const project = createRecentProject(result.path);
        await rememberRecentProject(project);
        setOverlay(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
    }
    setCreating(false);
  }, [parentPath, folderName, initGit, setOverlay]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOverlay(null); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, setOverlay]);

  if (!open) return null;

  const canCreate = parentPath.trim() && folderName.trim() && !creating;

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
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <FolderPlus size={16} className="text-text-secondary" />
                Create New Project
              </h2>
              <p className="text-[11px] text-text-tertiary mt-0.5">Create a project directory with git initialized, ready for workspaces</p>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-4">
              {/* Parent directory */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Parent Directory</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={parentPath}
                    onChange={(e) => { setParentPath(e.target.value); setError(null); }}
                    placeholder="/path/to/parent"
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary font-mono placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors"
                  />
                  <button
                    onClick={handleBrowse}
                    className="px-3 py-1.5 rounded-md border border-border bg-bg-secondary text-xs text-text-secondary hover:bg-bg-hover transition-colors flex items-center gap-1.5"
                  >
                    <FolderOpen size={12} />
                    Browse
                  </button>
                </div>
              </div>

              {/* Folder name */}
              <div>
                <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Folder Name</label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => { setFolderName(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) handleCreate(); }}
                  placeholder="my-project"
                  autoFocus
                  className="w-full px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors"
                />
              </div>

              {/* Git init checkbox */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={initGit}
                  onChange={(e) => setInitGit(e.target.checked)}
                  className="rounded border-border accent-accent"
                />
                <span className="text-xs text-text-secondary">Initialize as git repository</span>
              </label>

              {/* Error */}
              {error && (
                <p className="text-xs text-error">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setOverlay(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!canCreate}
                className="px-4 py-1.5 rounded-lg bg-success text-white text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {creating && <Loader2 size={12} className="animate-spin" />}
                Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
