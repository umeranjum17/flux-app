import { useEffect, useRef } from 'react';
import { Check, Star, ExternalLink } from 'lucide-react';
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

  // Keyboard shortcut selection
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        let idx = 0;
        for (const group of groups) {
          for (const model of group.models) {
            idx++;
            if (idx === num) {
              handleSelect(group.agent.id, model.id);
              return;
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** Check if a model ID looks like a Codex / external model */
  const isExternalModel = (agentId: string) =>
    agentId === 'codex' || agentId === 'openai';

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border border-border/60 bg-bg-elevated shadow-2xl z-50 py-2 max-h-96 overflow-y-auto"
    >
      {groups.map((group, gi) => (
        <div key={group.agent.id}>
          {gi > 0 && <div className="mx-3 my-1 border-t border-border-subtle/50" />}
          {/* Agent group header */}
          <div className="px-4 pt-2 pb-1">
            <span className="text-[11px] font-medium text-text-tertiary/70">
              {group.agent.name}
            </span>
          </div>
          {/* Model list */}
          {group.models.map((model) => {
            shortcutIndex++;
            const isSelected = group.agent.id === selectedAgentId && model.id === selectedModel;
            const currentShortcut = shortcutIndex;
            const external = isExternalModel(group.agent.id);
            return (
              <button
                key={`${group.agent.id}-${model.id}`}
                type="button"
                onClick={() => handleSelect(group.agent.id, model.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors ${
                  isSelected
                    ? 'bg-white/[0.04] text-text-primary'
                    : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                }`}
              >
                {/* Provider icon */}
                <AgentIcon
                  agentId={group.agent.id}
                  size={16}
                  className={AGENT_COLORS[group.agent.id] ?? 'text-text-tertiary'}
                />
                {/* Model name */}
                <span className="flex-1 text-left font-medium truncate">
                  {model.name}
                </span>
                {/* External link indicator for non-Claude models */}
                {external && (
                  <ExternalLink size={11} className="text-text-tertiary/50 shrink-0" />
                )}
                {/* Selected indicators */}
                {isSelected && (
                  <>
                    <Check size={14} className="text-text-secondary shrink-0" />
                    <Star size={13} className="text-text-tertiary fill-text-tertiary shrink-0" />
                  </>
                )}
                {/* Keyboard shortcut */}
                {currentShortcut <= 9 && (
                  <span className="text-[11px] text-text-tertiary/50 font-mono min-w-[14px] text-right tabular-nums">
                    {currentShortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="px-4 py-4 text-xs text-text-tertiary text-center">
          No agents available
        </div>
      )}
    </div>
  );
}
