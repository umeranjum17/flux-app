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
      { id: 'copilot', name: 'GitHub Copilot', available: true, models: ['gpt-5.4'] },
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

  it('uses the provider fallback model when selecting Copilot', () => {
    const agents = [
      { id: 'copilot', name: 'GitHub Copilot', available: true, models: ['gpt-5.4', 'claude-sonnet-4.6'] },
    ] as any[];
    mockApi.invoke.mockResolvedValue([]);
    useAgentStore.setState({ agents });

    useAgentStore.getState().setSelectedAgent('copilot' as any);

    const state = useAgentStore.getState();
    expect(state.selectedAgentId).toBe('copilot');
    expect(state.selectedModel).toBe('gpt-5.4');
    expect(mockApi.invoke).toHaveBeenCalledWith('agents:list-models', { agentId: 'copilot' });
  });
});

describe('fetchModels', () => {
  it('on success, sets dynamicModels and selectedModel to first model', async () => {
    const models = [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4', name: 'GPT-4' }];
    mockApi.invoke.mockResolvedValue(models);
    useAgentStore.setState({ selectedAgentId: 'openai' as any });

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
    useAgentStore.setState({ agents, selectedAgentId: 'openai' as any });
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

  it('ignores stale responses from a previously selected agent', async () => {
    const agents = [
      { id: 'openai', name: 'OpenAI', available: true, models: ['gpt-4o'] },
      { id: 'codex', name: 'Codex', available: true, models: ['gpt-5.1-codex'] },
    ] as any[];
    useAgentStore.setState({
      agents,
      selectedAgentId: 'openai',
      selectedModel: 'gpt-4o',
    });

    let resolveOpenAI: ((value: any) => void) | undefined;
    let resolveCodex: ((value: any) => void) | undefined;

    mockApi.invoke.mockImplementation((_channel: string, { agentId }: { agentId: string }) => (
      new Promise((resolve) => {
        if (agentId === 'openai') resolveOpenAI = resolve;
        if (agentId === 'codex') resolveCodex = resolve;
      })
    ));

    const openAiFetch = useAgentStore.getState().fetchModels('openai' as any);
    useAgentStore.setState({ selectedAgentId: 'codex', selectedModel: 'gpt-5.1-codex' });
    const codexFetch = useAgentStore.getState().fetchModels('codex' as any);

    resolveCodex?.([{ id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' }]);
    await codexFetch;

    resolveOpenAI?.([{ id: 'gpt-5', name: 'GPT-5' }]);
    await openAiFetch;

    const state = useAgentStore.getState();
    expect(state.selectedAgentId).toBe('codex');
    expect(state.dynamicModels).toEqual([{ id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' }]);
    expect(state.selectedModel).toBe('gpt-5.1-codex');
  });
});
