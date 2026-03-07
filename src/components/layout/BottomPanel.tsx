import { useRef, useCallback } from 'react';
import { Bot, TerminalSquare } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { ChatInput } from '../input/ChatInput';
import { TerminalPanel, type TerminalPanelHandle } from '../terminal/TerminalPanel';

export function BottomPanel() {
  const mode = useUiStore((s) => s.bottomPanelMode);
  const termRef = useRef<TerminalPanelHandle>(null);

  const switchToAgent = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('agent');
  }, []);

  const switchToTerminal = useCallback(() => {
    useUiStore.getState().setBottomPanelMode('terminal');
    requestAnimationFrame(() => termRef.current?.focusActive());
  }, []);

  const isAgent = mode === 'agent';

  return (
    <div className="flex flex-col border-t border-border bg-bg-primary shrink-0"
      style={{ height: isAgent ? 'auto' : 240, minHeight: isAgent ? undefined : 120 }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0 bg-bg-secondary border-b border-border">
        <button
          onClick={switchToAgent}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            isAgent
              ? 'border-accent text-accent'
              : 'border-transparent text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <Bot size={13} />
          Agent
        </button>
        <button
          onClick={switchToTerminal}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            !isAgent
              ? 'border-accent text-accent'
              : 'border-transparent text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <TerminalSquare size={13} />
          Terminal
        </button>
      </div>

      {/* Content */}
      {isAgent ? (
        <div className="px-3 py-2">
          <ChatInput focused={isAgent} />
        </div>
      ) : (
        <TerminalPanel ref={termRef} visible={!isAgent} />
      )}
    </div>
  );
}
