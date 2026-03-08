import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

const SECTIONS = [
  {
    title: 'Global',
    shortcuts: [
      { keys: 'Ctrl+T', description: 'Toggle Plan/Act mode' },
      { keys: 'Ctrl+B', description: 'Toggle sidebar' },
      { keys: 'Ctrl+K', description: 'Command palette' },
      { keys: 'Ctrl+E', description: 'Toggle file explorer' },
      { keys: 'Ctrl+Shift+D', description: 'Toggle theme' },
      { keys: 'Ctrl+`', description: 'Toggle terminal/agent' },
      { keys: 'F1', description: 'This help overlay' },
    ],
  },
  {
    title: 'Chat',
    shortcuts: [
      { keys: 'Enter / Cmd+Enter', description: 'Send message (configurable)' },
      { keys: 'ArrowUp', description: 'Previous input (at start of input)' },
      { keys: 'ArrowDown', description: 'Next input (at end of input)' },
      { keys: '/', description: 'Slash commands' },
      { keys: '@', description: 'Mention files' },
    ],
  },
  {
    title: 'Approval',
    shortcuts: [
      { keys: 'Y', description: 'Allow tool execution' },
      { keys: 'N', description: 'Deny tool execution' },
    ],
  },
];

export function HelpOverlay() {
  const overlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const isOpen = overlay === 'help';

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, setOverlay]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOverlay(null)}
        >
          <motion.div
            className="bg-bg-elevated border border-border rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-text-primary">Keyboard Shortcuts</h2>
              <button
                onClick={() => setOverlay(null)}
                className="p-1 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {SECTIONS.map((section) => (
                <div key={section.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                    {section.title}
                  </h3>
                  <div className="space-y-1">
                    {section.shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.keys}
                        className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-hover"
                      >
                        <span className="text-sm text-text-secondary">{shortcut.description}</span>
                        <kbd className="px-2 py-0.5 rounded bg-bg-primary border border-border text-[11px] font-mono text-text-tertiary">
                          {shortcut.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
