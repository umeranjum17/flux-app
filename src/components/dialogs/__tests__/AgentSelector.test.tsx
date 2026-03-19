import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { AgentSelector } from '../AgentSelector';
import { useAgentStore } from '../../../stores/agent';
import { useUiStore } from '../../../stores/ui';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useUiStore.setState({
    activeOverlay: 'agent-selector',
  } as any);

  useAgentStore.setState({
    agents: [
      {
        id: 'claude-code',
        name: 'Claude Code',
        path: '/usr/bin/claude',
        version: '1.0.0',
        available: true,
        models: ['sonnet', 'opus'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
      {
        id: 'copilot',
        name: 'GitHub Copilot',
        path: '/usr/bin/copilot',
        version: '1.0.5',
        available: true,
        models: ['gpt-5.4', 'claude-sonnet-4.6'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
      {
        id: 'codex',
        name: 'Codex',
        path: '',
        version: '1.0.0',
        available: false,
        models: ['gpt-5-codex'],
        supportsThinking: false,
        authStatus: 'unauthenticated',
        envKeys: [],
      },
    ],
    selectedAgentId: 'claude-code',
    selectedModel: 'sonnet',
    selectedThinking: 'medium',
    dynamicModels: [],
    modelsLoading: false,
    detecting: false,
  });
});

describe('AgentSelector', () => {
  it('renders static fallback models when dynamic models are empty', async () => {
    mockApi.invoke.mockResolvedValue([]);

    render(<AgentSelector />);

    await waitFor(() => {
      expect(mockApi.invoke).toHaveBeenCalledWith('agents:list-models', { agentId: 'claude-code' });
    });

    expect(screen.getByRole('option', { name: 'sonnet' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'opus' })).not.toBeNull();
  });

  it('disables unavailable agents instead of letting the user select them', () => {
    mockApi.invoke.mockResolvedValue([]);

    render(<AgentSelector />);

    const codexButtons = screen.getAllByRole('button', { name: /Codex/i }) as HTMLButtonElement[];
    expect(codexButtons.length).toBeGreaterThan(0);
    expect(codexButtons.every((button) => button.disabled)).toBe(true);
  });

  it('renders GitHub Copilot as a selectable provider', () => {
    mockApi.invoke.mockResolvedValue([]);

    render(<AgentSelector />);

    const copilotButtons = screen.getAllByRole('button', { name: /GitHub Copilot/i });
    expect(copilotButtons.length).toBeGreaterThan(0);
    expect(copilotButtons.some((button) => !button.hasAttribute('disabled'))).toBe(true);
  });

  it('commits the selected model only after Done is pressed', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockResolvedValue([
      { id: 'sonnet', name: 'sonnet' },
      { id: 'opus', name: 'opus' },
    ]);

    render(<AgentSelector />);

    const modelSelect = await screen.findByRole('combobox');
    await user.selectOptions(modelSelect, 'opus');

    expect(useAgentStore.getState().selectedModel).toBe('sonnet');

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(useAgentStore.getState().selectedModel).toBe('opus');
  });
});
