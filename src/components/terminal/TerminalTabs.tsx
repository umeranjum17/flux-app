import { Plus, X, GitBranch } from 'lucide-react';

export interface TerminalTab {
  id: string;
  title: string;
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

export function TerminalTabs({ tabs, activeId, onSelect, onClose, onCreate }: TerminalTabsProps) {
  return (
    <div className="flex items-center gap-0.5 px-2 bg-bg-secondary border-b border-border overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-b-2 transition-colors ${
            tab.id === activeId
              ? 'border-border-focus text-text-primary'
              : 'border-transparent text-text-tertiary hover:text-text-secondary'
          }`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.workspaceBranch && (
            <GitBranch size={10} className="shrink-0 text-accent" />
          )}
          <span className="truncate max-w-[120px]">{tab.title}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
            className="p-0.5 rounded hover:bg-bg-hover transition-colors"
            title={`Close ${tab.title}`}
            aria-label={`Close ${tab.title}`}
          >
            <X size={10} />
          </button>
        </div>
      ))}
      <button
        onClick={onCreate}
        className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
        aria-label="New terminal"
        title="New terminal"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
