import { describe, expect, it, vi } from 'vitest';

import { RemoteControlService } from '../control-service';

describe('RemoteControlService', () => {
  it('answers question requests and mirrors the user response into the session stream', async () => {
    const answerQuestion = vi.fn();
    const resume = vi.fn();
    const addMessage = vi.fn();
    const sendToRenderer = vi.fn(() => true);
    const taskHandle = {
      isAlive: () => true,
      answerQuestion,
    };

    const service = new RemoteControlService({
      activeTasks: new Map([['task-1', taskHandle as any]]),
      taskSessions: new Map([['task-1', 'session-1']]),
      taskStallMonitors: new Map([['task-1', { resume } as any]]),
      lifecycleManager: {
        taskStatusChanged: vi.fn(),
        getWorkspaceForTask: vi.fn(() => 'ws-1'),
      } as any,
      sessionStore: {
        addMessage,
      } as any,
      sendToRenderer,
    } as any);

    await service.answerTaskQuestion('task-1', 'req-1', 'Ship it');

    expect(answerQuestion).toHaveBeenCalledWith('req-1', 'Ship it');
    expect(addMessage).toHaveBeenCalledOnce();
    expect(sendToRenderer).toHaveBeenCalledWith('agent:message', expect.objectContaining({
      taskId: 'task-1',
      message: expect.objectContaining({
        role: 'user',
        content: 'Ship it',
      }),
    }));
    expect(resume).toHaveBeenCalledOnce();
  });

  it('returns workspace chats and session history from the existing stores', async () => {
    const listSessions = vi.fn(() => [{ sessionId: 'session-1' }]);
    const getSession = vi.fn(() => ({ id: 'session-1', title: 'Chat' }));
    const getMessages = vi.fn(() => [{ id: 1, content: 'Hello' }]);
    const service = new RemoteControlService({
      workspaceStore: {
        listSessions,
      } as any,
      sessionStore: {
        get: getSession,
        getMessages,
      } as any,
    } as any);

    await expect(service.listWorkspaceChats('ws-1')).resolves.toEqual([{ sessionId: 'session-1' }]);
    await expect(service.getSession('session-1')).resolves.toEqual({ id: 'session-1', title: 'Chat' });
    await expect(service.sessionMessages('session-1')).resolves.toEqual([{ id: 1, content: 'Hello' }]);
  });
});
