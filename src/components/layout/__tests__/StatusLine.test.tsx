import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { StatusLine } from '../StatusLine';
import { useAgentStore } from '../../../stores/agent';
import { useChatStore } from '../../../stores/chat';
import { useUiStore } from '../../../stores/ui';
import { useWorkspaceStore } from '../../../stores/workspace';
import type { LiveUsageOverview } from '../../../lib/ipc-api';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
  useWorkspaceStore.setState({
    workspaces: new Map(),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceOperations: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });
  useUiStore.setState({
    gitBranch: null,
    gitDirty: false,
    sshHost: null,
    sshConnected: false,
    environment: 'local',
    liveOverview: null,
    openProjects: [],
    cwd: '',
  } as any);
  useAgentStore.setState({
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        path: '/usr/bin/codex',
        version: '1.0.0',
        available: true,
        models: ['dup-model-x'],
        supportsThinking: true,
        authStatus: 'authenticated',
        envKeys: [],
      },
    ],
    selectedAgentId: 'codex',
    selectedModel: 'dup-model-x',
    selectedThinking: 'xhigh',
    detecting: false,
    dynamicModels: [],
    modelsLoading: false,
  });
});

describe('StatusLine', () => {
  it('scopes gauge severity to the active provider', async () => {
    const now = Date.now();
    const overview: LiveUsageOverview = {
      providers: [
        {
          providerId: 'claude-code',
          label: 'Claude Code',
          status: 'connected',
          fetchedAt: now,
          source: 'live',
          message: null,
          windows: [
            { providerId: 'claude-code', providerLabel: 'Claude Code', windowKey: 'five_hour', windowLabel: '5h', status: 'rejected', usedPercent: 1, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now, source: 'live', isStale: false, isExpired: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
          ],
        },
        {
          providerId: 'codex',
          label: 'Codex',
          status: 'connected',
          fetchedAt: now,
          source: 'live',
          message: null,
          windows: [
            { providerId: 'codex', providerLabel: 'Codex', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed', usedPercent: 0.32, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now, source: 'live', isStale: false, isExpired: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
          ],
        },
      ],
      history: [],
      updatedAt: now,
    };
    useUiStore.getState().setLiveOverview(overview);

    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Rate limit scope',
      agentId: 'codex',
      model: 'dup-model-x',
      mode: 'act',
      thinking: 'xhigh',
      cwd: '/workspace',
    });

    render(<StatusLine />);

    await waitFor(() => {
      expect(screen.getByLabelText('Peek rate limits')).not.toBeNull();
    });

    // Active agent is codex (allowed) — gauge dot should be green, not red
    const gaugeButton = screen.getByLabelText('Peek rate limits');
    const indicator = gaugeButton.querySelector('span.rounded-full');
    expect(indicator?.className).toContain('bg-emerald-400');
  });

  it('renders rate-limit window cards with status badges in popover', async () => {
    const now = Date.now();
    const overview: LiveUsageOverview = {
      providers: [
        {
          providerId: 'codex',
          label: 'Codex',
          status: 'connected',
          fetchedAt: now,
          source: 'live',
          message: null,
          windows: [
            { providerId: 'codex', providerLabel: 'Codex', windowKey: 'five_hour', windowLabel: '5h', status: 'allowed_warning', usedPercent: 0.82, resetsAt: now + 60_000, remainingMs: 60_000, fetchedAt: now, source: 'live', isStale: false, isExpired: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
            { providerId: 'codex', providerLabel: 'Codex', windowKey: 'seven_day', windowLabel: '7d', status: 'allowed', usedPercent: 0.33, resetsAt: now + 120_000, remainingMs: 120_000, fetchedAt: now, source: 'live', isStale: false, isExpired: false, usedValue: null, limitValue: null, remainingValue: null, unit: 'percent' },
          ],
        },
      ],
      history: [],
      updatedAt: now,
    };
    useUiStore.getState().setLiveOverview(overview);

    // Mock usage:live so that the popover refresh doesn't overwrite store data
    mockApi.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'usage:live') return overview;
      return null;
    });

    render(<StatusLine />);

    await waitFor(() => {
      expect(screen.getAllByLabelText('Peek rate limits').length).toBeGreaterThan(0);
    });

    // Open popover
    const gaugeButtons = screen.getAllByLabelText('Peek rate limits');
    gaugeButtons[gaugeButtons.length - 1]?.click();

    await waitFor(() => {
      expect(screen.getByText('Rate Limits')).not.toBeNull();
    });

    expect(screen.getByText('Warning')).not.toBeNull();
    expect(screen.getByText('Healthy')).not.toBeNull();
    expect(screen.getByText('82%')).not.toBeNull();
    expect(screen.getByText('18% remaining')).not.toBeNull();
  });
});
