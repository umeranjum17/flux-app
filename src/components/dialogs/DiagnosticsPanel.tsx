import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X, Copy, FileText } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

export function DiagnosticsPanel() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const open = activeOverlay === 'diagnostics';

  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const [logPath, logTail] = await Promise.all([
        window.api.invoke('diagnostics:path') as Promise<string>,
        window.api.invoke('diagnostics:tail', { lines: 300 }) as Promise<string>,
      ]);
      setPath(logPath);
      setContent(logTail);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLogs();
    const timer = window.setInterval(() => {
      void loadLogs();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [open, loadLogs]);

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content || '[No diagnostics captured]');
    } catch {
      // ignore clipboard failures
    }
  }, [content]);

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
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.14 }}
            className="bg-bg-elevated rounded-2xl w-full max-w-5xl h-[75vh] mx-4 border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <FileText size={15} />
                  Diagnostics
                </h2>
                <p className="text-[11px] text-text-tertiary font-mono truncate mt-0.5">
                  {path || 'Loading log path...'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void loadLogs()}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  title="Refresh logs"
                >
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => void handleCopy()}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  title="Copy logs"
                >
                  <Copy size={15} />
                </button>
                <button
                  onClick={() => setOverlay(null)}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  title="Close diagnostics"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="h-full overflow-auto bg-[#050505]">
              <pre className="min-h-full px-5 py-4 text-[12px] leading-5 text-[#d6dee8] font-mono whitespace-pre-wrap break-words">
                {content || 'No diagnostics captured yet.'}
              </pre>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
