import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { SessionPicker } from '../SessionPicker';
import { useAgentStore } from '../../../stores/agent';
import { useChatStore } from '../../../stores/chat';
import { useSessionStore } from '../../../stores/session';
import { useUiStore } from '../../../stores/ui';

let mockApi: MockApi;

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useChatStore.setState({ tasks: new Map(), activeTaskId: null });
  useUiStore.setState({ activeOverlay: 'session-picker', cwd: '/workspace' } as any);
  useAgentStore.setState({ selectedThinking: 'medium' } as any);
  useSessionStore.setState({
    sessions: [{
      id: 'session-1',
      title: 'Existing session',
      agentId: 'codex',
      model: 'gpt-5.1-codex',
      mode: 'act',
      cwd: '/workspace',
      createdAt: 1,
      updatedAt: 2,
      metadata: {},
    }],
    loading: false,
  });
});

describe('SessionPicker', () => {
  it('restores rich message payloads from payloadJson', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          id: 'session-1',
          title: 'Existing session',
          agentId: 'codex',
          model: 'gpt-5.1-codex',
          mode: 'act',
          cwd: '/workspace',
        });
      }

      if (channel === 'sessions:messages') {
        return Promise.resolve([{
          id: 1,
          sessionId: 'session-1',
          role: 'user',
          type: 'text',
          content: 'Review this',
          toolName: null,
          toolInput: null,
          toolCallId: null,
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
          payloadJson: JSON.stringify({
            type: 'text',
            role: 'user',
            content: 'Review this',
            timestamp: 100,
            attachments: [{ path: '/workspace/src/app.ts', name: 'app.ts' }],
            images: ['data:image/png;base64,abc'],
          }),
          timestamp: 100,
        }]);
      }

      return Promise.resolve(undefined);
    });

    render(<SessionPicker />);

    await user.click(screen.getByRole('button', { name: /Resume/i }));

    await waitFor(() => {
      expect(useChatStore.getState().activeTaskId).not.toBeNull();
    });

    const task = useChatStore.getState().getActiveTask();
    expect(task).toBeDefined();
    expect(task!.messages).toHaveLength(1);
    expect(task!.messages[0].attachments).toEqual([{ path: '/workspace/src/app.ts', name: 'app.ts' }]);
    expect(task!.messages[0].images).toEqual(['data:image/png;base64,abc']);
  });

  it('sanitizes legacy Claude startup hook dumps when restoring a session', async () => {
    const user = userEvent.setup();
    mockApi.invoke.mockImplementation((channel: string) => {
      if (channel === 'sessions:get') {
        return Promise.resolve({
          id: 'session-1',
          title: 'Existing session',
          agentId: 'claude-code',
          model: 'sonnet',
          mode: 'act',
          cwd: '/workspace',
        });
      }

      if (channel === 'sessions:messages') {
        return Promise.resolve([
          {
            id: 1,
            sessionId: 'session-1',
            role: 'system',
            type: 'text',
            content: JSON.stringify({
              type: 'system',
              subtype: 'hook_started',
              hook_event: 'SessionStart',
              hook_name: 'SessionStart:startup',
            }),
            toolName: null,
            toolInput: null,
            toolCallId: null,
            costUsd: null,
            inputTokens: null,
            outputTokens: null,
            payloadJson: JSON.stringify({
              type: 'text',
              role: 'system',
              content: JSON.stringify({
                type: 'system',
                subtype: 'hook_started',
                hook_event: 'SessionStart',
                hook_name: 'SessionStart:startup',
              }),
              timestamp: 100,
            }),
            timestamp: 100,
          },
          {
            id: 2,
            sessionId: 'session-1',
            role: 'system',
            type: 'text',
            content: JSON.stringify({
              type: 'system',
              subtype: 'hook_response',
              hook_event: 'SessionStart',
              hook_name: 'SessionStart:startup',
              output: '{ raw }',
            }),
            toolName: null,
            toolInput: null,
            toolCallId: null,
            costUsd: null,
            inputTokens: null,
            outputTokens: null,
            payloadJson: null,
            timestamp: 101,
          },
        ]);
      }

      return Promise.resolve(undefined);
    });

    render(<SessionPicker />);

    await user.click(screen.getByRole('button', { name: /Resume/i }));

    await waitFor(() => {
      expect(useChatStore.getState().activeTaskId).not.toBeNull();
    });

    const task = useChatStore.getState().getActiveTask();
    expect(task).toBeDefined();
    expect(task!.messages).toHaveLength(1);
    expect(task!.messages[0]).toMatchObject({
      type: 'status',
      statusKind: 'startup',
      content: 'Initializing Claude session',
    });
  });
});
