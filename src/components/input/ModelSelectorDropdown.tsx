import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';
import type { AgentId } from '../../lib/types';

interface ModelSelectorDropdownProps {
  open: boolean;
  onClose: () => void;
}

export function ModelSelectorDropdown({ open, onClose }: ModelSelectorDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);
  const agents = useAgentStore((s) => s.agents);
  const dynamicModels = useAgentStore((s) => s.dynamicModels);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedModel = useAgentStore((s) => s.selectedModel);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Build grouped model list
  const groups = agents
    .filter((a) => a.available)
    .map((agent) => {
      const models = agent.id === selectedAgentId && dynamicModels.length > 0
        ? dynamicModels
        : agent.models.map((m) => ({ id: m, name: m }));
      return { agent, models };
    });

  let shortcutIndex = 0;

  const handleSelect = (agentId: string, modelId: string) => {
    if (agentId !== selectedAgentId) {
      useAgentStore.getState().setSelectedAgent(agentId as AgentId);
    }
    useAgentStore.getState().setSelectedModel(modelId);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-border bg-bg-elevated shadow-2xl z-50 py-1.5 max-h-96 overflow-y-auto"
    >
      {groups.map((group, gi) => (
        <div key={group.agent.id}>
          {gi > 0 && <div className="mx-3 my-1.5 border-t border-border-subtle" />}
          {/* Agent group header */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <AgentIcon
              agentId={group.agent.id}
              size={13}
              className={AGENT_COLORS[group.agent.id] ?? 'text-text-tertiary'}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              {group.agent.name}
            </span>
            <span className="text-[10px] text-text-tertiary/60 ml-auto">
              {group.models.length} model{group.models.length !== 1 ? 's' : ''}
            </span>
          </div>
          {/* Model list */}
          {group.models.map((model) => {
            shortcutIndex++;
            const isSelected = group.agent.id === selectedAgentId && model.id === selectedModel;
            const currentShortcut = shortcutIndex;
            return (
              <button
                key={`${group.agent.id}-${model.id}`}
                type="button"
                onClick={() => handleSelect(group.agent.id, model.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                  isSelected
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                {/* Selection indicator */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isSelected ? 'bg-accent' : 'bg-transparent'
                }`} />
                <span className="flex-1 text-left font-medium truncate">
                  {model.name}
                </span>
                {isSelected && <Check size={14} className="text-accent shrink-0" />}
                {currentShortcut <= 9 && (
                  <kbd className="text-[10px] text-text-tertiary/60 font-mono px-1 py-0.5 rounded bg-bg-primary/60 border border-border-subtle/50 min-w-[18px] text-center">
                    {currentShortcut}
                  </kbd>
                )}
              </button>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="px-3 py-4 text-xs text-text-tertiary text-center">
          No agents available
        </div>
      )}
    </div>
  );
}
