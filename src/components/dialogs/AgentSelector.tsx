import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ChevronDown, RefreshCw, Loader2 } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import { AgentIcon, AGENT_COLORS } from '../icons/AgentIcons';
import type { AgentId, ModelInfo, ThinkingLevel } from '../../lib/types';

const thinkingLevels: { value: ThinkingLevel; label: string; short: string }[] = [
  { value: 'disabled', label: 'Disabled', short: 'Off' },
  { value: 'low', label: 'Low', short: 'L' },
  { value: 'medium', label: 'Medium', short: 'M' },
  { value: 'high', label: 'High', short: 'H' },
  { value: 'xhigh', label: 'Extra High', short: 'XH' },
];

export function AgentSelector() {
  const { activeOverlay, setOverlay } = useUiStore();
  const {
    agents,
    selectedAgentId,
    selectedModel,
    selectedThinking,
    dynamicModels,
    setSelectedAgent,
    setSelectedModel,
    setSelectedThinking,
  } = useAgentStore();

  const open = activeOverlay === 'agent-selector';
  const [draftAgentId, setDraftAgentId] = useState<AgentId>(selectedAgentId);
  const [draftModel, setDraftModel] = useState(selectedModel);
  const [draftThinking, setDraftThinking] = useState(selectedThinking);
  const [draftModels, setDraftModels] = useState<ModelInfo[]>(dynamicModels);
  const [draftModelsLoading, setDraftModelsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const draftFetchSequence = useRef(0);
  const selectedAgent = agents.find((a) => a.id === draftAgentId);

  const modelOptions = useMemo(() => {
    if (!selectedAgent) return [];
    const fallbackModels = selectedAgent.models.map((model) => ({ id: model, name: model }));
    const combined = draftModels.length > 0 ? draftModels : fallbackModels;
    if (!draftModel || combined.some((model) => model.id === draftModel)) {
      return combined;
    }
    return [{ id: draftModel, name: draftModel }, ...combined];
  }, [draftModel, draftModels, selectedAgent]);

  useEffect(() => {
    if (!open) return;
    setDraftAgentId(selectedAgentId);
    setDraftModel(selectedModel);
    setDraftThinking(selectedThinking);
    setDraftModels(dynamicModels);
    setReloadToken(0);
  }, [open, selectedAgentId, selectedModel, selectedThinking, dynamicModels]);

  useEffect(() => {
    if (!open || !draftAgentId) return;
    const requestId = ++draftFetchSequence.current;
    const fallbackModels = agents.find((agent) => agent.id === draftAgentId)?.models ?? [];
    setDraftModelsLoading(true);

    void window.api.invoke('agents:list-models', { agentId: draftAgentId }).then((result) => {
      if (draftFetchSequence.current !== requestId) return;
      const fetchedModels = Array.isArray(result) ? result as ModelInfo[] : [];
      setDraftModels(fetchedModels);
      setDraftModel((current) => {
        if (fetchedModels.some((model) => model.id === current)) return current;
        if (fallbackModels.includes(current)) return current;
        return fetchedModels[0]?.id ?? fallbackModels[0] ?? '';
      });
    }).catch(() => {
      if (draftFetchSequence.current !== requestId) return;
      const fallback = fallbackModels.map((model) => ({ id: model, name: model }));
      setDraftModels(fallback);
      setDraftModel((current) => (
        fallbackModels.includes(current)
          ? current
          : fallbackModels[0] ?? ''
      ));
    }).finally(() => {
      if (draftFetchSequence.current === requestId) {
        setDraftModelsLoading(false);
      }
    });
  }, [open, draftAgentId, agents, reloadToken]);

  const closeWithoutSaving = () => {
    setOverlay(null);
  };

  const applySelection = () => {
    if (draftAgentId !== selectedAgentId) {
      setSelectedAgent(draftAgentId);
    }
    if (draftModel !== selectedModel) {
      setSelectedModel(draftModel);
    }
    if (draftThinking !== selectedThinking) {
      setSelectedThinking(draftThinking);
    }
    setOverlay(null);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeWithoutSaving}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="bg-bg-elevated rounded-2xl p-6 max-w-md w-full mx-4 border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[15px] font-semibold text-text-primary">Select Agent</h2>
              <button
                type="button"
                onClick={closeWithoutSaving}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title="Close agent selector"
                aria-label="Close agent selector"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1 mb-5 max-h-64 overflow-y-auto">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    if (!agent.available) return;
                    const fallbackModel = agent.models[0] ?? '';
                    setDraftAgentId(agent.id);
                    setDraftModels([]);
                    setDraftModel(fallbackModel);
                    setDraftThinking((current) => (
                      agent.supportsThinking
                        ? current
                        : 'disabled'
                    ));
                  }}
                  disabled={!agent.available}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
                    agent.id === draftAgentId
                      ? 'bg-bg-elevated text-text-primary ring-1 ring-border'
                      : agent.available
                        ? 'text-text-secondary hover:bg-bg-hover'
                        : 'text-text-tertiary opacity-50 cursor-not-allowed'
                  }`}
                >
                  <AgentIcon
                    agentId={agent.id}
                    size={16}
                    className={agent.id === draftAgentId
                      ? (AGENT_COLORS[agent.id] ?? 'text-text-primary')
                      : 'text-text-tertiary'
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13px]">{agent.name}</span>
                      <span className="text-[11px] text-text-tertiary">v{agent.version}</span>
                      {!agent.available && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-primary border border-border-subtle">
                          unavailable
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${
                      agent.authStatus === 'authenticated'
                        ? 'bg-success'
                        : agent.authStatus === 'unauthenticated'
                          ? 'bg-error'
                          : 'bg-warning'
                    }`}
                    title={agent.authStatus}
                  />
                  {agent.id === draftAgentId && (
                    <Check size={15} className="flex-shrink-0 text-success" />
                  )}
                </button>
              ))}

              {agents.length === 0 && (
                <p className="text-[13px] text-text-tertiary text-center py-6">
                  No agents detected. Check your PATH configuration.
                </p>
              )}
            </div>

            {selectedAgent && (
              <div className="space-y-4 border-t border-border pt-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                      Model
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setReloadToken((current) => current + 1);
                      }}
                      disabled={draftModelsLoading}
                      className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                      title="Refresh models"
                    >
                      <RefreshCw size={12} className={draftModelsLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  {draftModelsLoading && draftModels.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-tertiary bg-bg-primary border border-border rounded-xl">
                      <Loader2 size={13} className="animate-spin" />
                      Loading models...
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={draftModel}
                        onChange={(e) => setDraftModel(e.target.value)}
                        disabled={modelOptions.length === 0}
                        className="w-full bg-bg-primary border border-border rounded-xl px-3 py-2.5 text-[13px] text-text-primary appearance-none outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/20 transition-all"
                      >
                        {modelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={13}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                      />
                    </div>
                  )}
                </div>

                {selectedAgent.supportsThinking && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                      Thinking Level
                    </label>
                    <div className="flex rounded-xl bg-bg-primary border border-border p-[3px]">
                      {thinkingLevels.map((level) => (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => setDraftThinking(level.value)}
                          className={`flex-1 px-2.5 py-2 rounded-[10px] text-[12px] font-medium transition-all duration-150 ${
                            draftThinking === level.value
                              ? 'bg-success text-white shadow-sm'
                              : 'text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={applySelection}
              className="w-full mt-5 px-4 py-2.5 bg-success text-white rounded-xl text-[13px] font-medium hover:bg-success/85 transition-colors shadow-sm"
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
