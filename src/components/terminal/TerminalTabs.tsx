import { Plus, X, SquareTerminal } from 'lucide-react';

export interface TerminalTab {
  id: string;
  title: string;
  shellName?: string;
  workspaceId?: string;
  workspaceBranch?: string;
}

interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export function TerminalTabs({
  tabs, activeId, onSelect, onClose, onCreate,
}: TerminalTabsProps) {
  return (
    <div className="flex items-center h-[34px] bg-bg-secondary border-b border-border select-none">
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto px-1 gap-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 pl-2 pr-1 h-[26px] rounded text-[11px] cursor-pointer transition-colors shrink-0 ${
                isActive
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover/50'
              }`}
              onClick={() => onSelect(tab.id)}
            >
              <SquareTerminal size={12} className={isActive ? 'text-text-secondary' : 'text-text-tertiary'} />
              <span className="truncate max-w-[100px]">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={`p-0.5 rounded transition-colors shrink-0 ${
                  isActive
                    ? 'text-text-tertiary hover:text-text-primary hover:bg-bg-primary/50'
                    : 'opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary hover:bg-bg-primary/50'
                }`}
                title={`Close ${tab.title}`}
                aria-label={`Close ${tab.title}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center px-1.5 shrink-0 border-l border-border/50">
        <button
          onClick={onCreate}
          className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          title="New Terminal"
          aria-label="New Terminal"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
