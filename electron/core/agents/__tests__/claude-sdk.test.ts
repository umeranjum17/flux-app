import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock the SDK before importing the module under test
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

import { spawnClaudeSdk } from '../claude-sdk';
import type { SpawnOptions } from '../types';

function baseOptions(overrides?: Partial<SpawnOptions>): SpawnOptions {
  return {
    taskId: 'test-task-1',
    prompt: 'Hello Claude',
    mode: 'act',
    cwd: '/tmp/test',
    ...overrides,
  };
}

/** Create a fake async generator that yields SDK messages then returns. */
function createFakeQuery(messages: any[]) {
  let closed = false;
  const gen = {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        if (closed) return;
        yield msg;
      }
    },
    close: vi.fn(() => { closed = true; }),
    interrupt: vi.fn(),
    streamInput: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setMaxThinkingTokens: vi.fn().mockResolvedValue(undefined),
    initializationResult: vi.fn().mockResolvedValue({}),
    supportedCommands: vi.fn().mockResolvedValue([]),
    supportedModels: vi.fn().mockResolvedValue([]),
    supportedAgents: vi.fn().mockResolvedValue([]),
    mcpServerStatus: vi.fn().mockResolvedValue([]),
    accountInfo: vi.fn().mockResolvedValue({}),
    reconnectMcpServer: vi.fn().mockResolvedValue(undefined),
    toggleMcpServer: vi.fn().mockResolvedValue(undefined),
    setMcpServers: vi.fn().mockResolvedValue({}),
    stopTask: vi.fn().mockResolvedValue(undefined),
  };
  // Make the generator itself act as an AsyncGenerator
  const iter = gen[Symbol.asyncIterator]();
  return Object.assign(iter, gen);
}

describe('spawnClaudeSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits startup status message synchronously', () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    // Register listener BEFORE creating handle to catch synchronous emit
    const messages: any[] = [];
    const origEmit = EventEmitter.prototype.emit;
    const patchedEmit = function (this: any, event: string, ...args: any[]) {
      if (event === 'message') messages.push(args[0]);
      return origEmit.call(this, event, ...args);
    };
    EventEmitter.prototype.emit = patchedEmit;

    try {
      spawnClaudeSdk(baseOptions());
      expect(messages[0]).toMatchObject({
        type: 'status',
        statusKind: 'spawn',
        content: expect.stringContaining('Starting Claude'),
      });
    } finally {
      EventEmitter.prototype.emit = origEmit;
    }
  });

  it('maps SDKAssistantMessage text blocks to text AgentMessage', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'assistant',
        uuid: 'msg-1',
        session_id: 'sess-1',
        message: {
          content: [
            { type: 'text', text: 'Hello from Claude!' },
          ],
        },
        parent_tool_use_id: null,
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    const textMsgs = messages.filter((m) => m.type === 'text');
    expect(textMsgs).toHaveLength(1);
    expect(textMsgs[0]).toMatchObject({
      type: 'text',
      role: 'assistant',
      content: 'Hello from Claude!',
    });
  });

  it('maps tool_use blocks to tool_call AgentMessage', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'assistant',
        uuid: 'msg-2',
        session_id: 'sess-1',
        message: {
          content: [
            { type: 'tool_use', id: 'tc-1', name: 'Read', input: { file_path: '/test.ts' } },
          ],
        },
        parent_tool_use_id: null,
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    const toolCalls = messages.filter((m) => m.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      type: 'tool_call',
      toolName: 'Read',
      toolCallId: 'tc-1',
      toolInput: { file_path: '/test.ts' },
    });
  });

  it('maps thinking blocks to thinking AgentMessage', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'assistant',
        uuid: 'msg-3',
        session_id: 'sess-1',
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me think about this...' },
          ],
        },
        parent_tool_use_id: null,
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    const thinkingMsgs = messages.filter((m) => m.type === 'thinking');
    expect(thinkingMsgs).toHaveLength(1);
    expect(thinkingMsgs[0].content).toBe('Let me think about this...');
  });

  it('maps result message with cost and tokens', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'result',
        subtype: 'success',
        uuid: 'res-1',
        session_id: 'sess-1',
        result: 'Task completed',
        total_cost_usd: 0.05,
        total_input_tokens: 1000,
        total_output_tokens: 500,
        duration_ms: 12000,
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    const results = messages.filter((m) => m.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'result',
      content: 'Task completed',
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 12000,
    });
  });

  it('captures session ID from system init message', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'captured-session-id',
        uuid: 'sys-1',
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const sessionMetas: any[] = [];
    handle.on('session-meta', (meta: any) => sessionMetas.push(meta));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    expect(sessionMetas).toHaveLength(1);
    expect(sessionMetas[0]).toEqual({ id: 'captured-session-id' });
  });

  it('emits done with no error on normal completion', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const result = await new Promise<any>((resolve) => handle.once('done', resolve));
    expect(result.error).toBeNull();
  });

  it('emits done with error message on failure', async () => {
    // Make the query throw an error
    mockQuery.mockImplementation(() => {
      const gen = {
        async *[Symbol.asyncIterator]() {
          throw new Error('API key invalid');
        },
        close: vi.fn(),
        streamInput: vi.fn(),
      };
      const iter = gen[Symbol.asyncIterator]();
      return Object.assign(iter, gen);
    });

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    const result = await new Promise<any>((resolve) => handle.once('done', resolve));

    expect(result.error).toBe('API key invalid');
    expect(messages.some((m) => m.type === 'error')).toBe(true);
  });

  it('stop() aborts the query and emits done without error', async () => {
    // Create a query that would run forever
    let yieldResolve: (() => void) | null = null;
    const fakeQuery = createFakeQuery([]);
    // Override to make it hang
    const originalIter = fakeQuery[Symbol.asyncIterator];
    const hangingGen = {
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => { yieldResolve = resolve; });
      },
      close: vi.fn(() => { yieldResolve?.(); }),
      streamInput: vi.fn(),
    };
    const hangIter = hangingGen[Symbol.asyncIterator]();
    mockQuery.mockReturnValue(Object.assign(hangIter, hangingGen));

    const handle = spawnClaudeSdk(baseOptions());
    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 10));

    await handle.stop();
    expect(handle.isAlive()).toBe(false);
  });

  it('isAlive() returns true before done, false after', async () => {
    const fakeQuery = createFakeQuery([
      { type: 'assistant', uuid: 'msg-1', session_id: 's', message: { content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    expect(handle.isAlive()).toBe(true);

    await new Promise<void>((resolve) => handle.once('done', resolve));
    expect(handle.isAlive()).toBe(false);
  });

  it('passes resume option when resumeSessionId is set', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    spawnClaudeSdk(baseOptions({ resumeSessionId: 'resume-sess-123' }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.resume).toBe('resume-sess-123');
  });

  it('sets plan permission mode for plan mode', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    spawnClaudeSdk(baseOptions({ mode: 'plan' }));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('plan');
  });

  it('sets bypassPermissions mode when dangerouslyBypassPermissions is true', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    spawnClaudeSdk(baseOptions({ dangerouslyBypassPermissions: true }));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
  });

  it('maps effort from thinking level', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    spawnClaudeSdk(baseOptions({ thinking: 'xhigh' }));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.effort).toBe('max');
  });

  describe('canUseTool callback', () => {
    it('emits permission_request and resolves on approve()', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      const handle = spawnClaudeSdk(baseOptions());
      const messages: any[] = [];
      handle.on('message', (msg: any) => messages.push(msg));

      // Wait for query to be called
      await new Promise((r) => setTimeout(r, 10));
      expect(canUseToolFn).toBeTruthy();

      // Simulate SDK calling canUseTool for a Bash command
      const permPromise = canUseToolFn('Bash', { command: 'rm -rf /' }, {
        signal: new AbortController().signal,
        toolUseID: 'tool-1',
      });

      // Should have emitted a permission_request
      await new Promise((r) => setTimeout(r, 10));
      const permMsgs = messages.filter((m) => m.type === 'permission_request');
      expect(permMsgs).toHaveLength(1);
      expect(permMsgs[0]).toMatchObject({
        requestId: 'tool-1',
        toolName: 'Bash',
      });

      // Approve it
      handle.approve('tool-1');
      const result = await permPromise;
      expect(result).toEqual({ behavior: 'allow' });
    });

    it('resolves with deny on deny()', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      const handle = spawnClaudeSdk(baseOptions());
      await new Promise((r) => setTimeout(r, 10));

      const permPromise = canUseToolFn('Bash', { command: 'rm -rf /' }, {
        signal: new AbortController().signal,
        toolUseID: 'tool-2',
      });

      handle.deny('tool-2');
      const result = await permPromise;
      expect(result).toEqual({ behavior: 'deny', message: 'User denied permission' });
    });

    it('emits question_request for AskUserQuestion and resolves on answerQuestion()', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      const handle = spawnClaudeSdk(baseOptions());
      const messages: any[] = [];
      handle.on('message', (msg: any) => messages.push(msg));
      await new Promise((r) => setTimeout(r, 10));

      const questionPromise = canUseToolFn('AskUserQuestion', {
        questions: [{
          question: 'Which framework?',
          options: [{ label: 'React' }, { label: 'Vue' }],
        }],
      }, {
        signal: new AbortController().signal,
        toolUseID: 'q-1',
      });

      await new Promise((r) => setTimeout(r, 10));
      const questionMsgs = messages.filter((m) => m.type === 'question_request');
      expect(questionMsgs).toHaveLength(1);
      expect(questionMsgs[0]).toMatchObject({
        requestId: 'q-1',
        questions: expect.arrayContaining([
          expect.objectContaining({ question: 'Which framework?' }),
        ]),
      });

      handle.answerQuestion('q-1', 'React');
      const result = await questionPromise;
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: { answer: 'React' },
      });
    });

    it('handles MCP-prefixed AskUserQuestion', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      const handle = spawnClaudeSdk(baseOptions());
      const messages: any[] = [];
      handle.on('message', (msg: any) => messages.push(msg));
      await new Promise((r) => setTimeout(r, 10));

      canUseToolFn('mcp__conductor__AskUserQuestion', {
        questions: [{ question: 'Which DB?' }],
      }, {
        signal: new AbortController().signal,
        toolUseID: 'q-2',
      });

      await new Promise((r) => setTimeout(r, 10));
      const questionMsgs = messages.filter((m) => m.type === 'question_request');
      expect(questionMsgs).toHaveLength(1);
    });

    it('auto-approves interactive tools like ExitPlanMode', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      spawnClaudeSdk(baseOptions());
      await new Promise((r) => setTimeout(r, 10));

      const result = await canUseToolFn('ExitPlanMode', {}, {
        signal: new AbortController().signal,
        toolUseID: 'tool-3',
      });

      expect(result).toEqual({ behavior: 'allow' });
    });

    it('auto-approves everything in bypass mode', async () => {
      let canUseToolFn: any = null;
      mockQuery.mockImplementation((args: any) => {
        canUseToolFn = args.options.canUseTool;
        return createFakeQuery([]);
      });

      spawnClaudeSdk(baseOptions({ dangerouslyBypassPermissions: true }));
      await new Promise((r) => setTimeout(r, 10));

      const result = await canUseToolFn('Bash', { command: 'rm -rf /' }, {
        signal: new AbortController().signal,
        toolUseID: 'tool-4',
      });

      expect(result).toEqual({ behavior: 'allow' });
    });
  });

  it('maps user tool_result messages', async () => {
    const fakeQuery = createFakeQuery([
      {
        type: 'user',
        uuid: 'usr-1',
        session_id: 'sess-1',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tc-1', content: 'file contents here', is_error: false },
          ],
        },
        parent_tool_use_id: null,
      },
    ]);
    mockQuery.mockReturnValue(fakeQuery);

    const handle = spawnClaudeSdk(baseOptions());
    const messages: any[] = [];
    handle.on('message', (msg: any) => messages.push(msg));
    await new Promise<void>((resolve) => handle.once('done', resolve));

    const toolResults = messages.filter((m) => m.type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      type: 'tool_result',
      role: 'tool',
      content: 'file contents here',
      toolCallId: 'tc-1',
      isError: false,
    });
  });

  it('prepends contextBlock to prompt', async () => {
    const fakeQuery = createFakeQuery([]);
    mockQuery.mockReturnValue(fakeQuery);

    spawnClaudeSdk(baseOptions({ contextBlock: '## Repo Map\n- src/index.ts' }));
    await new Promise((r) => setTimeout(r, 10));

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toContain('## Repo Map');
    expect(callArgs.prompt).toContain('Hello Claude');
  });
});
