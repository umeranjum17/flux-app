import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, type MockApi } from '../../../test/mocks/window-api';

import { useAgentStore } from '../agent';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;
  useAgentStore.setState({
    agents: [], selectedAgentId: 'claude-code', selectedModel: 'sonnet',
    selectedThinking: 'medium', detecting: false, dynamicModels: [], modelsLoading: false,
  });
});

describe('setAgents', () => {
  it('stores agents array and sets detecting to false', () => {
    useAgentStore.setState({ detecting: true });
    const agents = [
      { id: 'claude-code', name: 'Claude Code', available: true, models: ['sonnet'] },
      { id: 'codex', name: 'Codex', available: true, models: ['o3-mini'] },
    ] as any[];
    useAgentStore.getState().setAgents(agents);

    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0].id).toBe('claude-code');
    expect(state.detecting).toBe(false);
  });
});

describe('setSelectedAgent', () => {
  it('sets the ID, clears dynamicModels, and triggers fetchModels', () => {
    const agents = [
      { id: 'claude-code', name: 'Claude Code', available: true, models: ['sonnet'] },
      { id: 'codex', name: 'Codex', available: true, models: ['o3-mini'] },
    ] as any[];
    mockApi.invoke.mockResolvedValue([]);
    useAgentStore.setState({ agents });
    useAgentStore.setState({ dynamicModels: [{ id: 'old', name: 'old' }] as any[] });

    useAgentStore.getState().setSelectedAgent('codex' as any);

    const state = useAgentStore.getState();
    expect(state.selectedAgentId).toBe('codex');
    expect(state.dynamicModels).toEqual([]);
    expect(state.selectedModel).toBe('o3-mini');
    expect(mockApi.invoke).toHaveBeenCalledWith('agents:list-models', { agentId: 'codex' });
  });
});

describe('fetchModels', () => {
  it('on success, sets dynamicModels and selectedModel to first model', async () => {
    const models = [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4', name: 'GPT-4' }];
    mockApi.invoke.mockResolvedValue(models);

    await useAgentStore.getState().fetchModels('openai' as any);

    const state = useAgentStore.getState();
    expect(state.dynamicModels).toEqual(models);
    expect(state.selectedModel).toBe('gpt-4o');
    expect(state.modelsLoading).toBe(false);
  });

  it('on failure, falls back to static agent models', async () => {
    const agents = [
      { id: 'openai', name: 'OpenAI', available: true, models: ['gpt-4o', 'gpt-4'] },
    ] as any[];
    useAgentStore.setState({ agents });
    mockApi.invoke.mockRejectedValue(new Error('network error'));

    await useAgentStore.getState().fetchModels('openai' as any);

    const state = useAgentStore.getState();
    expect(state.modelsLoading).toBe(false);
    expect(state.dynamicModels).toEqual([
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4', name: 'gpt-4' },
    ]);
    expect(state.selectedModel).toBe('gpt-4o');
  });
});
