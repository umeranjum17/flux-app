import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Loader2, Clock, X, FolderOpen, ChevronRight, ArrowUp, Home } from 'lucide-react';
import { getActiveOpenProject, useUiStore } from '../../stores/ui';
import { createRecentProject, rememberRecentProject } from '../../lib/workspace-state';
import type { FluxConfig } from '../../lib/ipc-api';

interface RecentSshHost {
  host: string;
  remotePath: string;
  lastUsed: number;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface DirectoryListingResult {
  path: string;
  entries: DirEntry[];
  error: string | null;
}

export function ConnectRemoteDialog() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const open = activeOverlay === 'connect-remote';

  const [host, setHost] = useState('');
  const [remotePath, setRemotePath] = useState('~');
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentHosts, setRecentHosts] = useState<RecentSshHost[]>([]);

  // Inline folder browser state
  const [browsing, setBrowsing] = useState(false);
  const [browseEntries, setBrowseEntries] = useState<DirEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseResolvedPath, setBrowseResolvedPath] = useState('');
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const ui = useUiStore.getState();
      const activeProject = getActiveOpenProject(ui);
      setHost(activeProject?.isSSH ? activeProject.sshHost ?? '' : '');
      setRemotePath(activeProject?.isSSH ? activeProject.path || '~' : '~');
      setError(null);
      setTesting(false);
      setConnecting(false);
      setBrowsing(false);
      setBrowseEntries([]);
      setBrowseResolvedPath('');
      setBrowseError(null);
      window.api.invoke('config:get').then((raw) => {
        const config = raw as FluxConfig;
        setRecentHosts(config?.recentSshHosts ?? []);
      });
    }
  }, [open]);

  const saveRecentHost = useCallback(async (h: string, path: string) => {
    const config = await window.api.invoke('config:get') as FluxConfig;
    const existing: RecentSshHost[] = config?.recentSshHosts ?? [];
    const filtered = existing.filter((e) => !(e.host === h && e.remotePath === path));
    const updated = [{ host: h, remotePath: path, lastUsed: Date.now() }, ...filtered].slice(0, 10);
    await window.api.invoke('config:set', { recentSshHosts: updated });
    setRecentHosts(updated);
  }, []);

  const removeRecentHost = useCallback(async (h: string, path: string) => {
    const config = await window.api.invoke('config:get') as FluxConfig;
    const existing: RecentSshHost[] = config?.recentSshHosts ?? [];
    const updated = existing.filter((e) => !(e.host === h && e.remotePath === path));
    await window.api.invoke('config:set', { recentSshHosts: updated });
    setRecentHosts(updated);
  }, []);

  const handleTest = useCallback(async () => {
    if (!host.trim()) return;
    setTesting(true);
    setError(null);
    try {
      const result = await window.api.invoke('ssh:test', { host: host.trim() }) as { success: boolean; error: string | null };
      if (!result.success) setError(result.error || 'Connection failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    }
    setTesting(false);
  }, [host]);

  const handleConnect = useCallback(async () => {
    if (!host.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const remoteDir = remotePath.trim() || '~';
      const dirResult = await window.api.invoke('ssh:listdirs', {
        host: host.trim(),
        dirPath: remoteDir,
      }) as DirectoryListingResult;
      if (dirResult.error) {
        throw new Error(dirResult.error);
      }
      const resolvedPath = dirResult.path || remoteDir;
      const connectResult = await window.api.invoke('ssh:connect', {
        host: host.trim(),
        remoteCwd: resolvedPath,
      }) as { host?: string; cwd?: string };
      const resolvedHost = connectResult.host ?? host.trim();
      const finalPath = connectResult.cwd ?? resolvedPath;

      await saveRecentHost(resolvedHost, finalPath);
      useUiStore.getState().connectSsh(resolvedHost, finalPath);
      const project = createRecentProject(finalPath, { source: 'ssh', sshHost: resolvedHost });
      await rememberRecentProject(project);
      setOverlay(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
    setConnecting(false);
  }, [host, remotePath, setOverlay, saveRecentHost]);

  const selectRecent = useCallback((r: RecentSshHost) => {
    setHost(r.host);
    setRemotePath(r.remotePath);
  }, []);

  // ── Inline folder browser ──────────────────────────────────

  const loadBrowseDir = useCallback(async (dirPath: string) => {
    if (!host.trim()) {
      setBrowseError('Enter a host first');
      return;
    }
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const result = await window.api.invoke('ssh:listdirs', {
        host: host.trim(),
        dirPath,
      }) as DirectoryListingResult;
      if (result.error) {
        setBrowseError(result.error);
      } else {
        setBrowseResolvedPath(result.path);
        setBrowseEntries(result.entries.filter((e) => e.isDirectory));
      }
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Failed to list directory');
    }
    setBrowseLoading(false);
  }, [host]);

  const openBrowser = useCallback(async () => {
    if (!host.trim()) {
      setError('Enter a host first');
      return;
    }
    setBrowsing(true);
    setBrowseEntries([]);
    setBrowseResolvedPath('');
    void loadBrowseDir(remotePath.trim() || '~');
  }, [host, remotePath, loadBrowseDir]);

  const handleBrowseSelect = useCallback(() => {
    const selected = browseResolvedPath || remotePath;
    setRemotePath(selected);
    setBrowsing(false);
  }, [browseResolvedPath, remotePath]);

  const handleBrowseCancel = useCallback(() => {
    setBrowsing(false);
    setBrowseError(null);
  }, []);

  const handleBrowseNavigate = useCallback((dirName: string) => {
    const base = browseResolvedPath || remotePath;
    const newPath = base.endsWith('/') ? `${base}${dirName}` : `${base}/${dirName}`;
    loadBrowseDir(newPath);
  }, [browseResolvedPath, remotePath, loadBrowseDir]);

  const handleBrowseUp = useCallback(() => {
    const base = browseResolvedPath || remotePath;
    const parent = base.split('/').slice(0, -1).join('/') || '/';
    loadBrowseDir(parent);
  }, [browseResolvedPath, remotePath, loadBrowseDir]);

  const handleBrowseHome = useCallback(() => {
    loadBrowseDir('~');
  }, [loadBrowseDir]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (browsing) {
          handleBrowseCancel();
        } else {
          setOverlay(null);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, browsing, setOverlay, handleBrowseCancel]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => { if (browsing) handleBrowseCancel(); else setOverlay(null); }}
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
                <Wifi size={16} className="text-text-secondary" />
                Add SSH Project
              </h2>
              <p className="text-[11px] text-text-tertiary mt-0.5">Enter the SSH host and project path to add. This project will appear in the sidebar alongside local projects.</p>
            </div>

            {browsing ? (
              <>
                {/* Browse mode — inline folder picker */}
                <div className="px-5 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <button onClick={handleBrowseHome} className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title="Home">
                      <Home size={14} />
                    </button>
                    <button onClick={handleBrowseUp} className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors" title="Parent directory">
                      <ArrowUp size={14} />
                    </button>
                    <span className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary font-mono truncate">
                      {browseResolvedPath || '~'}
                    </span>
                  </div>
                </div>

                <div className="h-[260px] overflow-y-auto">
                  {browseLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={16} className="animate-spin text-text-tertiary" />
                    </div>
                  )}
                  {browseError && <p className="text-xs text-error px-5 py-4">{browseError}</p>}
                  {!browseLoading && !browseError && browseEntries.length === 0 && (
                    <p className="text-[11px] text-text-tertiary px-5 py-6 text-center">No subdirectories</p>
                  )}
                  {!browseLoading && browseEntries.map((entry) => (
                    <button
                      key={entry.name}
                      onClick={() => handleBrowseNavigate(entry.name)}
                      className="w-full flex items-center gap-2.5 px-5 py-2 text-left hover:bg-bg-hover transition-colors"
                    >
                      <FolderOpen size={14} className="text-text-secondary shrink-0" />
                      <span className="text-xs text-text-primary truncate">{entry.name}</span>
                      <ChevronRight size={12} className="text-text-tertiary ml-auto shrink-0" />
                    </button>
                  ))}
                </div>

                {/* Browse footer */}
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <button
                    onClick={handleBrowseCancel}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBrowseSelect}
                    className="px-4 py-1.5 rounded-lg bg-success text-white text-xs font-medium hover:opacity-90 transition-colors"
                  >
                    Select
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Form */}
                <div className="px-5 py-4 space-y-4">
                  {/* Host */}
                  <div>
                    <label className="block text-[12px] font-medium text-text-secondary mb-1.5">SSH Host</label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => { setHost(e.target.value); setError(null); }}
                      placeholder="user@192.168.1.100"
                      autoFocus
                      className="w-full px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary font-mono placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors"
                    />
                  </div>

                  {/* Remote Path */}
                  <div>
                    <label className="block text-[12px] font-medium text-text-secondary mb-1.5">Project Path on Host</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={remotePath}
                        onChange={(e) => { setRemotePath(e.target.value); setError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && host.trim()) handleConnect(); }}
                        placeholder="~/projects/my-app"
                        className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs text-text-primary font-mono placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors"
                      />
                      <button
                        onClick={openBrowser}
                        disabled={!host.trim() || testing}
                        className="px-3 py-1.5 rounded-md border border-border bg-bg-secondary text-xs text-text-secondary hover:bg-bg-hover transition-colors flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <FolderOpen size={12} />
                        Browse SSH
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-bg-primary/60 px-3 py-2 text-[11px] text-text-tertiary">
                    Flux will add this SSH project source to the sidebar and remember the host/path for quick reopening.
                  </div>

                  {/* Recent hosts */}
                  {recentHosts.length > 0 && (
                    <div>
                      <label className="block text-[12px] font-medium text-text-secondary mb-1.5 flex items-center gap-1">
                        <Clock size={11} />
                        Recent SSH Projects
                      </label>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {recentHosts.map((r) => (
                          <div
                            key={`${r.host}:${r.remotePath}`}
                            className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs cursor-pointer hover:border-border-focus/50 transition-colors"
                            onClick={() => selectRecent(r)}
                          >
                            <span className="font-mono text-text-primary truncate">{r.host}</span>
                            <span className="text-text-tertiary truncate flex-1">{r.remotePath}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeRecentHost(r.host, r.remotePath); }}
                              className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error transition-all p-0.5"
                              title="Remove"
                              aria-label="Remove"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <p className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
                  <button
                    onClick={handleTest}
                    disabled={!host.trim() || testing}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {testing && <Loader2 size={12} className="animate-spin" />}
                    Test SSH
                  </button>
                  <button
                    onClick={() => setOverlay(null)}
                    className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConnect}
                    disabled={!host.trim() || connecting}
                    className="px-4 py-1.5 rounded-lg bg-success text-white text-xs font-medium hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {connecting && <Loader2 size={12} className="animate-spin" />}
                    Connect & Add
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
