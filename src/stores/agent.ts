import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DetectedAgent, AgentId, ThinkingLevel, ModelInfo } from '../lib/types';

interface AgentState {
  agents: DetectedAgent[];
  selectedAgentId: AgentId;
  selectedModel: string;
  selectedThinking: ThinkingLevel;
  detecting: boolean;
  dynamicModels: ModelInfo[];
  modelsLoading: boolean;

  setAgents(agents: DetectedAgent[]): void;
  setSelectedAgent(id: AgentId): void;
  setSelectedModel(model: string): void;
  setSelectedThinking(level: ThinkingLevel): void;
  setDetecting(detecting: boolean): void;
  getSelectedAgent(): DetectedAgent | undefined;
  fetchModels(agentId: AgentId): Promise<void>;
  /** Sync the selector to match a workspace's stored agent, model, and thinking level. */
  syncToWorkspace(agentId: AgentId, model: string, thinking?: ThinkingLevel): void;
}

let modelsRequestSequence = 0;

export const useAgentStore = create<AgentState>()(
  immer((set, get) => ({
    agents: [],
    selectedAgentId: 'claude-code',
    selectedModel: 'sonnet',
    selectedThinking: 'medium',
    detecting: false,
    dynamicModels: [],
    modelsLoading: false,

    setAgents(agents) {
      set((state) => {
        state.agents = agents;
        state.detecting = false;
      });
    },

    setSelectedAgent(id) {
      const fallbackModel = get().agents.find((agent) => agent.id === id)?.models[0] ?? '';
      set((state) => {
        state.selectedAgentId = id;
        state.dynamicModels = [];
        state.selectedModel = fallbackModel;
      });
      void get().fetchModels(id);
    },

    async fetchModels(agentId) {
      const requestId = ++modelsRequestSequence;
      set((state) => {
        state.modelsLoading = true;
      });
      try {
        const models = await window.api.invoke('agents:list-models', { agentId }) as ModelInfo[];
        const fallbackModel = get().agents.find((agent) => agent.id === agentId)?.models[0] ?? '';
        if (requestId !== modelsRequestSequence) return;
        set((state) => {
          if (state.selectedAgentId !== agentId) {
            state.modelsLoading = false;
            return;
          }
          state.dynamicModels = models;
          state.modelsLoading = false;
          if (models.length > 0) {
            state.selectedModel = models.some((model) => model.id === state.selectedModel)
              ? state.selectedModel
              : models[0].id;
          } else {
            state.selectedModel = fallbackModel;
          }
        });
      } catch {
        if (requestId !== modelsRequestSequence) return;
        set((state) => {
          if (state.selectedAgentId !== agentId) {
            state.modelsLoading = false;
            return;
          }
          state.modelsLoading = false;
          // Fall back to static models
          const agent = state.agents.find((a) => a.id === agentId);
          if (agent && agent.models.length > 0) {
            state.dynamicModels = agent.models.map((m) => ({ id: m, name: m }));
            state.selectedModel = agent.models.includes(state.selectedModel)
              ? state.selectedModel
              : agent.models[0];
          }
        });
      }
    },

    setSelectedModel(model) {
      set((state) => {
        state.selectedModel = model;
      });
    },

    setSelectedThinking(level) {
      set((state) => {
        state.selectedThinking = level;
      });
    },

    setDetecting(detecting) {
      set((state) => {
        state.detecting = detecting;
      });
    },

    getSelectedAgent() {
      const { agents, selectedAgentId } = get();
      return agents.find((a) => a.id === selectedAgentId);
    },

    syncToWorkspace(agentId, model, thinking?) {
      const current = get();
      const agentChanged = current.selectedAgentId !== agentId;
      set((state) => {
        state.selectedAgentId = agentId;
        state.selectedModel = model;
        if (thinking) {
          state.selectedThinking = thinking;
        }
        if (agentChanged) {
          state.dynamicModels = [];
        }
      });
      // Always fetch models so the selector stays correct after a workspace switch,
      // even when the agent hasn't changed (the user may have manually picked a
      // different model in the previous workspace).
      void get().fetchModels(agentId);
    },
  })),
);
