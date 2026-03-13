import { useEffect, useRef } from 'react';
import { Check, Star } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import type { AgentId } from '../../lib/types';

interface ModelSelectorDropdownProps {
  open: boolean;
  onClose: () => void;
}

const AGENT_ICONS: Record<string, string> = {
  'claude-code': '*',
  codex: '@',
  gemini: '#',
  openai: '$',
  ollama: '~',
};

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
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-border bg-bg-elevated shadow-2xl z-50 py-1 max-h-80 overflow-y-auto"
    >
      {groups.map((group, gi) => (
        <div key={group.agent.id}>
          {gi > 0 && <div className="mx-3 my-1 border-t border-border-subtle" />}
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            {group.agent.name}
          </div>
          {group.models.map((model) => {
            shortcutIndex++;
            const isSelected = group.agent.id === selectedAgentId && model.id === selectedModel;
            const currentShortcut = shortcutIndex;
            return (
              <button
                key={`${group.agent.id}-${model.id}`}
                type="button"
                onClick={() => handleSelect(group.agent.id, model.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  isSelected
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className="text-text-tertiary text-[10px] font-mono w-3">
                  {AGENT_ICONS[group.agent.id] || '*'}
                </span>
                <span className="flex-1 text-left font-medium">{model.name}</span>
                {isSelected && <Check size={14} className="text-accent shrink-0" />}
                {isSelected && <Star size={12} className="text-accent shrink-0" />}
                <kbd className="text-[10px] text-text-tertiary font-mono px-1 py-0.5 rounded bg-bg-primary border border-border-subtle min-w-[18px] text-center">
                  {currentShortcut}
                </kbd>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
