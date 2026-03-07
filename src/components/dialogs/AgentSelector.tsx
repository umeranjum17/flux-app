import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ChevronDown, RefreshCw, Loader2 } from 'lucide-react';
import { useAgentStore } from '../../stores/agent';
import { useUiStore } from '../../stores/ui';
import type { ThinkingLevel } from '../../lib/types';

const thinkingLevels: { value: ThinkingLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

export function AgentSelector() {
  const { activeOverlay, setOverlay } = useUiStore();
  const {
    agents,
    selectedAgentId,
    selectedModel,
    selectedThinking,
    dynamicModels,
    modelsLoading,
    setSelectedAgent,
    setSelectedModel,
    setSelectedThinking,
    fetchModels,
  } = useAgentStore();

  const open = activeOverlay === 'agent-selector';
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const lastFetchedAgentRef = useRef<string | null>(null);
  const modelOptions = selectedAgent
    ? (() => {
        const fallbackModels = selectedAgent.models.map((model) => ({ id: model, name: model }));
        const combined = dynamicModels.length > 0 ? dynamicModels : fallbackModels;
        if (!selectedModel || combined.some((model) => model.id === selectedModel)) {
          return combined;
        }
        return [{ id: selectedModel, name: selectedModel }, ...combined];
      })()
    : [];

  // Fetch models when the dialog opens
  useEffect(() => {
    if (!open) {
      lastFetchedAgentRef.current = null;
      return;
    }

    if (
      selectedAgentId &&
      !modelsLoading &&
      lastFetchedAgentRef.current !== selectedAgentId
    ) {
      lastFetchedAgentRef.current = selectedAgentId;
      fetchModels(selectedAgentId);
    }
  }, [open, selectedAgentId, modelsLoading, fetchModels]);

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
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="bg-bg-elevated rounded-2xl p-6 max-w-md w-full mx-4 border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-text-primary">Select Agent</h2>
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1 mb-6 max-h-64 overflow-y-auto">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => agent.available && setSelectedAgent(agent.id)}
                  disabled={!agent.available}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    agent.id === selectedAgentId
                      ? 'bg-accent-muted text-text-primary'
                      : agent.available
                        ? 'text-text-secondary hover:bg-bg-hover'
                        : 'text-text-tertiary opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{agent.name}</span>
                      <span className="text-xs text-text-tertiary">v{agent.version}</span>
                      {!agent.available && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-primary border border-border">
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
                  {agent.id === selectedAgentId && (
                    <Check size={16} className="flex-shrink-0 text-accent" />
                  )}
                </button>
              ))}

              {agents.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-4">
                  No agents detected. Check your PATH configuration.
                </p>
              )}
            </div>

            {selectedAgent && (
              <div className="space-y-4 border-t border-border pt-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-text-tertiary">
                      Model
                    </label>
                    <button
                      type="button"
                      onClick={() => fetchModels(selectedAgentId)}
                      disabled={modelsLoading}
                      className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                      title="Refresh models"
                    >
                      <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>
                  {modelsLoading && dynamicModels.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-text-tertiary bg-bg-primary border border-border rounded-lg">
                      <Loader2 size={14} className="animate-spin" />
                      Loading models…
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={modelOptions.length === 0}
                        className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary appearance-none outline-none focus:border-border-focus transition-colors"
                      >
                        {modelOptions.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
                      />
                    </div>
                  )}
                </div>

                {selectedAgent.supportsThinking && (
                  <div>
                    <label className="block text-xs font-medium text-text-tertiary mb-1.5">
                      Thinking Level
                    </label>
                    <div className="flex gap-1.5">
                      {thinkingLevels.map((level) => (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => setSelectedThinking(level.value)}
                          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            selectedThinking === level.value
                              ? 'bg-accent text-white'
                              : 'bg-bg-primary text-text-secondary hover:bg-bg-hover border border-border'
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
              onClick={() => setOverlay(null)}
              className="w-full mt-5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
