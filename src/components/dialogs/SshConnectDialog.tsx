import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, Loader2, Clock, X } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

interface RecentSshHost {
  host: string;
  remotePath: string;
  lastUsed: number;
}

export function SshConnectDialog() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const setOverlay = useUiStore((s) => s.setOverlay);

  const [host, setHost] = useState('');
  const [remotePath, setRemotePath] = useState('~');
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentHosts, setRecentHosts] = useState<RecentSshHost[]>([]);

  const open = activeOverlay === 'ssh-connect';

  // Load recent SSH hosts when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      setTesting(false);
      setConnecting(false);
      window.api.invoke('config:get').then((config: any) => {
        setRecentHosts(config?.recentSshHosts ?? []);
      });
    }
  }, [open]);

  const saveRecentHost = useCallback(async (h: string, path: string) => {
    const config = await window.api.invoke('config:get') as any;
    const existing: RecentSshHost[] = config?.recentSshHosts ?? [];
    const filtered = existing.filter((e) => !(e.host === h && e.remotePath === path));
    const updated = [{ host: h, remotePath: path, lastUsed: Date.now() }, ...filtered].slice(0, 10);
    await window.api.invoke('config:set', { recentSshHosts: updated });
    setRecentHosts(updated);
  }, []);

  const removeRecentHost = useCallback(async (h: string, path: string) => {
    const config = await window.api.invoke('config:get') as any;
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
      if (!result.success) {
        setError(result.error || 'Connection failed');
      } else {
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'Test failed');
    }
    setTesting(false);
  }, [host]);

  const handleConnect = useCallback(async () => {
    if (!host.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const remoteDir = remotePath.trim() || '~';
      // This now throws if SSH can't connect
      await window.api.invoke('ssh:connect', { host: host.trim(), remoteCwd: remoteDir });
      // Resolve the remote path before committing UI state
      let resolvedPath = remoteDir;
      try {
        const dirResult = await window.api.invoke('fs:listdirs', { dirPath: remoteDir }) as { path: string };
        resolvedPath = dirResult?.path || remoteDir;
      } catch {
        // Path resolution failed — use raw path, don't block connection
      }
      // All good — update UI state atomically
      await saveRecentHost(host.trim(), remoteDir);
      useUiStore.getState().connectSsh(host.trim(), resolvedPath);
      await window.api.invoke('cwd:set', { cwd: resolvedPath });
      setOverlay(null);
    } catch (err: any) {
      // SSH connection failed — revert any partial state
      await window.api.invoke('ssh:disconnect').catch(() => {});
      useUiStore.getState().disconnectSsh(useUiStore.getState().cwd);
      setError(err.message || 'Connection failed');
    }
    setConnecting(false);
  }, [host, remotePath, setOverlay, saveRecentHost]);

  const handleDisconnect = useCallback(async () => {
    const result = await window.api.invoke('ssh:disconnect') as { cwd?: string };
    useUiStore.getState().disconnectSsh(result?.cwd || useUiStore.getState().cwd);
    setOverlay(null);
  }, [setOverlay]);

  const selectRecent = useCallback((r: RecentSshHost) => {
    setHost(r.host);
    setRemotePath(r.remotePath);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOverlay(null);
      }
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
            className="bg-bg-elevated rounded-2xl w-full max-w-md mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                {sshConnected ? <Wifi size={16} className="text-success" /> : <WifiOff size={16} className="text-text-tertiary" />}
                SSH Connection
              </h2>
            </div>

            <div className="px-6 py-4 space-y-4">
              {sshConnected ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">
                    Connected to <span className="font-mono text-accent">{useUiStore.getState().sshHost}</span>
                  </p>
                  <button
                    onClick={handleDisconnect}
                    className="w-full py-2 rounded-lg bg-error/10 text-error text-sm font-medium hover:bg-error/20 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-text-secondary font-medium">Host (user@hostname)</label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="user@192.168.1.100"
                      autoFocus
                      className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-text-secondary font-medium">Remote Project Path</label>
                    <input
                      type="text"
                      value={remotePath}
                      onChange={(e) => setRemotePath(e.target.value)}
                      placeholder="~/projects/my-app"
                      className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  {recentHosts.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-text-secondary font-medium flex items-center gap-1">
                        <Clock size={11} />
                        Recent
                      </label>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {recentHosts.map((r) => (
                          <div
                            key={`${r.host}:${r.remotePath}`}
                            className="group flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-sm cursor-pointer hover:border-accent/50 transition-colors"
                            onClick={() => selectRecent(r)}
                          >
                            <span className="font-mono text-accent text-xs truncate">{r.host}</span>
                            <span className="text-text-tertiary text-xs truncate flex-1">{r.remotePath}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRecentHost(r.host, r.remotePath);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-error transition-all p-0.5"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {error && (
                    <p className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleTest}
                      disabled={!host.trim() || testing}
                      className="flex-1 py-2 rounded-lg bg-bg-primary border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {testing && <Loader2 size={14} className="animate-spin" />}
                      Test
                    </button>
                    <button
                      onClick={handleConnect}
                      disabled={!host.trim() || connecting}
                      className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {connecting && <Loader2 size={14} className="animate-spin" />}
                      Connect
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
