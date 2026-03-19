/**
 * Integration test for the Copilot agent's delta-buffering pipeline.
 *
 * Feeds realistic NDJSON events through the REAL spawnCopilot code path
 * (via a mocked child process) and collects every AgentMessage that gets
 * emitted.  This tells us exactly what the renderer would receive — no
 * guessing.
 */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnCopilot } from '../copilot';
import { spawnAgentProcess } from '../spawn-utils';
import type { AgentMessage } from '../types';

vi.mock('../spawn-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spawn-utils')>();
  return {
    ...actual,
    spawnAgentProcess: vi.fn(),
  };
});

class FakeReadable extends EventEmitter {}

class FakeWritable extends EventEmitter {
  writable = true;
  writes: string[] = [];

  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeReadable();
  stderr = new FakeReadable();
  stdin = new FakeWritable();
  pid = 12345;
  kill = vi.fn();
}

function emitLine(proc: FakeChildProcess, event: Record<string, unknown>): void {
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`, 'utf-8'));
}

function emitLines(proc: FakeChildProcess, events: Record<string, unknown>[]): void {
  // Send all events as a single chunk (like the OS might deliver them)
  const data = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  proc.stdout.emit('data', Buffer.from(data, 'utf-8'));
}

describe('spawnCopilot — delta buffering integration', () => {
  const mockedSpawnAgentProcess = vi.mocked(spawnAgentProcess);
  let proc: FakeChildProcess;
  let messages: AgentMessage[];

  beforeEach(() => {
    vi.useFakeTimers();
    proc = new FakeChildProcess();
    mockedSpawnAgentProcess.mockReset();
    mockedSpawnAgentProcess.mockReturnValue(proc as any);
    messages = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function spawn() {
    const handle = spawnCopilot({
      taskId: 'task-1',
      prompt: 'fix the bug',
      mode: 'act',
      cwd: '/workspace',
    });
    handle.on('message', (msg: AgentMessage) => messages.push(msg));
    return handle;
  }

  // -------------------------------------------------------------------------
  // 1. Verify delta buffering coalesces tokens
  // -------------------------------------------------------------------------
  it('coalesces rapid text deltas into a single message on flush', () => {
    spawn();

    // Simulate 10 rapid token-level deltas (what copilot --stream sends)
    for (const token of ['The ', 'quick ', 'brown ', 'fox ', 'jumps ', 'over ', 'the ', 'lazy ', 'dog', '.']) {
      emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: token } });
    }

    // Nothing emitted yet (timer hasn't fired)
    expect(messages).toHaveLength(0);

    // Advance past the 32ms flush interval
    vi.advanceTimersByTime(50);

    // Should be ONE message with all tokens merged
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('text');
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('The quick brown fox jumps over the lazy dog.');
  });

  // -------------------------------------------------------------------------
  // 2. Non-delta events flush the buffer but shouldn't create extra messages
  // -------------------------------------------------------------------------
  it('non-delta events flush accumulated text but unrecognized events emit nothing extra', () => {
    spawn();

    // Some text deltas
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' world' } });

    // Unrecognized event forces flush
    emitLine(proc, { type: 'session.tools_updated', data: {} });

    // The flush should have emitted the text
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello world');

    // More text after the unrecognized event
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: '!' } });
    vi.advanceTimersByTime(50);

    // Second flush — this is a SEPARATE emitMessage call
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('!');

    // Both are text/assistant — renderer's shouldMergeStreamChunk will merge these
    expect(messages.every((m) => m.type === 'text' && m.role === 'assistant')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Full session: thinking → text → tool → text → result
  // -------------------------------------------------------------------------
  it('produces the correct message sequence for a full session', () => {
    spawn();

    // --- Thinking phase ---
    emitLine(proc, { type: 'assistant.reasoning_delta', data: { deltaContent: 'Let me ' } });
    emitLine(proc, { type: 'assistant.reasoning_delta', data: { deltaContent: 'analyze...' } });
    vi.advanceTimersByTime(50);

    // --- End thinking, start text ---
    emitLine(proc, { type: 'assistant.reasoning', data: { content: 'Let me analyze...' } }); // suppressed
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'I\'ll fix ' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'the bug.' } });
    vi.advanceTimersByTime(50);

    // --- Full message (suppressed because deltas already sent it) ---
    emitLine(proc, { type: 'assistant.message', data: { content: 'I\'ll fix the bug.' } });

    // --- Tool execution ---
    emitLine(proc, { type: 'tool.execution_start', data: { toolName: 'edit_file', toolCallId: 'tc-1', arguments: { path: '/src/app.ts' } } });
    emitLine(proc, { type: 'tool.execution_progress', data: { toolCallId: 'tc-1', progressMessage: 'Editing...' } });
    emitLine(proc, { type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true, result: { content: 'File edited' } } });

    // --- Second turn text ---
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Done! ' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Changes applied.' } });
    vi.advanceTimersByTime(50);
    emitLine(proc, { type: 'assistant.message', data: { content: 'Done! Changes applied.' } }); // suppressed

    // --- Result ---
    emitLine(proc, { type: 'result', sessionId: 'sess-1', usage: { inputTokens: 500, outputTokens: 200 } });

    // Log what we got
    console.log('\n=== MESSAGES EMITTED BY COPILOT AGENT ===');
    for (const [i, m] of messages.entries()) {
      console.log(`  [${i}] type=${m.type} role=${m.role} content=${JSON.stringify(m.content).slice(0, 80)}`);
    }
    console.log(`  TOTAL: ${messages.length} messages\n`);

    // Verify the sequence. Raw agent emissions now include authoritative
    // replacement messages for completed thinking/text chunks; the renderer
    // collapses those back down to one visible bubble per segment.
    const types = messages.map((m) => m.type);
    expect(types).toEqual([
      'thinking',    // "Let me analyze..."     (coalesced)
      'thinking',    // authoritative replacement
      'text',        // "I'll fix the bug."      (coalesced)
      'text',        // authoritative replacement
      'tool_call',   // edit_file
      'tool_result', // "File edited"
      'text',        // "Done! Changes applied." (coalesced)
      'text',        // authoritative replacement
      'result',      // completion
    ]);

    // Verify content was coalesced, not token-by-token
    expect(messages[0].content).toBe('Let me analyze...');
    expect(messages[1]).toMatchObject({ content: 'Let me analyze...', replaceLastContent: true });
    expect(messages[2].content).toBe('I\'ll fix the bug.');
    expect(messages[3]).toMatchObject({ content: 'I\'ll fix the bug.', replaceLastContent: true });
    expect(messages[6].content).toBe('Done! Changes applied.');
    expect(messages[7]).toMatchObject({ content: 'Done! Changes applied.', replaceLastContent: true });
  });

  // -------------------------------------------------------------------------
  // 4. Rapid interleaving: deltas + unrecognized events every few tokens
  //    This simulates the worst case where Copilot sends session.tools_updated
  //    or other events between token groups.
  // -------------------------------------------------------------------------
  it('handles rapid interleaving of deltas and unrecognized events', () => {
    spawn();

    // Simulate: tokens → unrecognized → tokens → unrecognized → tokens
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } });
    emitLine(proc, { type: 'session.tools_updated', data: {} }); // flush
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' beautiful' } });
    emitLine(proc, { type: 'assistant.turn_start', data: {} }); // flush (unrecognized)
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' world' } });
    vi.advanceTimersByTime(50);

    console.log('\n=== INTERLEAVED MESSAGES ===');
    for (const [i, m] of messages.entries()) {
      console.log(`  [${i}] type=${m.type} role=${m.role} content=${JSON.stringify(m.content)}`);
    }
    console.log(`  TOTAL: ${messages.length} text messages (renderer must merge these)\n`);

    // Each unrecognized event forces a flush → separate emitMessage calls
    // The RENDERER's shouldMergeStreamChunk should merge them all into one bubble
    const textMessages = messages.filter((m) => m.type === 'text');
    expect(textMessages.length).toBeGreaterThanOrEqual(1);

    // All text messages are type=text, role=assistant (mergeable)
    for (const m of textMessages) {
      expect(m.type).toBe('text');
      expect(m.role).toBe('assistant');
    }

    // Total text content should be the full string
    const fullText = textMessages.map((m) => m.content).join('');
    expect(fullText).toBe('Hello beautiful world');
  });

  // -------------------------------------------------------------------------
  // 5. Replacement: authoritative assistant.message after deltas should
  //    emit a replacement chunk so the renderer can overwrite the delta text.
  // -------------------------------------------------------------------------
  it('emits an authoritative replacement assistant.message after deltas', () => {
    spawn();

    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } });
    vi.advanceTimersByTime(50); // flush

    // Full message arrives — it should replace the prior delta chunk.
    emitLine(proc, { type: 'assistant.message', data: { content: 'Hello', outputTokens: 10 } });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello');
    expect(messages[1]).toMatchObject({
      type: 'text',
      role: 'assistant',
      content: 'Hello',
      replaceLastContent: true,
    });
  });

  it('emits an empty replacement when Copilot hides the authoritative text payload', () => {
    spawn();

    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Dependencies' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'are' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'missing' } });
    vi.advanceTimersByTime(50);

    emitLine(proc, {
      type: 'assistant.message',
      data: {
        content: '',
        encryptedContent: 'opaque',
        outputTokens: 10,
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Dependenciesaremissing');
    expect(messages[1]).toMatchObject({
      type: 'text',
      role: 'assistant',
      content: '',
      replaceLastContent: true,
    });
  });

  // -------------------------------------------------------------------------
  // 6. Partial results are suppressed
  // -------------------------------------------------------------------------
  it('suppresses tool.execution_partial_result events', () => {
    spawn();

    emitLine(proc, { type: 'tool.execution_start', data: { toolName: 'bash', toolCallId: 'tc-1' } });
    emitLine(proc, { type: 'tool.execution_partial_result', data: { toolCallId: 'tc-1', partialOutput: 'partial...' } });
    emitLine(proc, { type: 'tool.execution_complete', data: { toolCallId: 'tc-1', success: true, result: { content: 'full output' } } });

    const types = messages.map((m) => m.type);
    expect(types).toEqual(['tool_call', 'tool_result']);
    expect(messages[1].content).toBe('full output');
  });

  // -------------------------------------------------------------------------
  // 7. onBeforeFinish flushes remaining deltas
  // -------------------------------------------------------------------------
  it('flushes remaining deltas on process close', () => {
    spawn();

    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'final words' } });

    // Process closes before timer fires
    proc.emit('close', 0);

    // The onBeforeFinish hook should have flushed
    expect(messages.some((m) => m.type === 'text' && m.content === 'final words')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Thinking + text interleaving (within same flush)
  // -------------------------------------------------------------------------
  it('handles thinking and text in the same buffer flush', () => {
    spawn();

    // Both buffers accumulate before timer fires
    emitLine(proc, { type: 'assistant.reasoning_delta', data: { deltaContent: 'hmm...' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'here' } });

    vi.advanceTimersByTime(50);

    console.log('\n=== THINKING + TEXT SAME FLUSH ===');
    for (const [i, m] of messages.entries()) {
      console.log(`  [${i}] type=${m.type} content=${JSON.stringify(m.content)}`);
    }

    // Both should be emitted as separate messages (different types).
    // Thinking is emitted first to match natural LLM order (reasoning
    // precedes response) and to reduce interleaving in the store.
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('thinking');
    expect(messages[0].content).toBe('hmm...');
    expect(messages[1].type).toBe('text');
    expect(messages[1].content).toBe('here');
  });

  it('coalesces interleaved thinking and text deltas into stable grouped flushes', () => {
    spawn();

    emitLine(proc, { type: 'assistant.reasoning_delta', data: { deltaContent: 'Let me ' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'I can ' } });
    emitLine(proc, { type: 'assistant.reasoning_delta', data: { deltaContent: 'think first. ' } });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'help now.' } });

    expect(messages).toHaveLength(0);

    vi.advanceTimersByTime(50);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      type: 'thinking',
      role: 'assistant',
      content: 'Let me think first. ',
    });
    expect(messages[1]).toMatchObject({
      type: 'text',
      role: 'assistant',
      content: 'I can help now.',
    });
  });

  // -------------------------------------------------------------------------
  // 9. END-TO-END: agent messages → store ingestStreamBatch
  //    Simulates the full pipeline: agent emits → IPC → renderer batches →
  //    store merges. This is the critical test for the "separate bubbles" bug.
  // -------------------------------------------------------------------------
  it('E2E: interleaved flushes merge into one bubble when fed to the store', async () => {
    // We need the real chat store for this test
    const { useChatStore } = await import('../../../../src/stores/chat');
    useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
    useChatStore.getState().createTask({
      id: 'cop-e2e',
      title: 'E2E test',
      agentId: 'copilot',
      model: 'gpt-4o',
      mode: 'act',
      thinking: 'medium',
      cwd: '/tmp',
    });

    spawn();

    // Simulate worst-case: deltas interleaved with unrecognized events
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } });
    emitLine(proc, { type: 'session.tools_updated', data: {} }); // forces flush
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' beautiful' } });
    emitLine(proc, { type: 'user.message', data: {} }); // forces flush
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' world' } });
    vi.advanceTimersByTime(50);

    // Agent emitted 3 separate text messages
    const textMsgs = messages.filter((m) => m.type === 'text');
    expect(textMsgs).toHaveLength(3);

    // Now feed them to the store (simulating renderer's RAF batch)
    useChatStore.getState().ingestStreamBatch(
      textMsgs.map((m) => ({ taskId: 'cop-e2e', message: m })),
    );

    const task = useChatStore.getState().tasks.get('cop-e2e')!;
    const storeMsgs = task.messages.filter((m) => m.type === 'text');

    console.log('\n=== E2E: STORE MESSAGES AFTER INGEST ===');
    for (const [i, m] of task.messages.entries()) {
      console.log(`  [${i}] type=${m.type} content=${JSON.stringify(m.content)}`);
    }

    // CRITICAL: should be ONE message, not three
    expect(storeMsgs).toHaveLength(1);
    expect(storeMsgs[0].content).toBe('Hello beautiful world');
  });

  // -------------------------------------------------------------------------
  // 10. END-TO-END: restoreMessages (the actual bug path)
  //     Simulates what happens when a Copilot session is reloaded from SQLite.
  //     Each delta flush was persisted as a separate row.
  // -------------------------------------------------------------------------
  it('E2E: restoreMessages merges persisted delta chunks into one bubble', async () => {
    const { useChatStore } = await import('../../../../src/stores/chat');
    useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
    useChatStore.getState().createTask({
      id: 'cop-restore',
      title: 'Restore test',
      agentId: 'copilot',
      model: 'gpt-4o',
      mode: 'act',
      thinking: 'medium',
      cwd: '/tmp',
    });
    useChatStore.getState().setTaskStatus('cop-restore', 'done');

    spawn();

    // Simulate the same interleaving
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: 'Hello' } });
    emitLine(proc, { type: 'session.tools_updated', data: {} });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' beautiful' } });
    emitLine(proc, { type: 'user.message', data: {} });
    emitLine(proc, { type: 'assistant.message_delta', data: { deltaContent: ' world' } });
    vi.advanceTimersByTime(50);

    // These 3 messages would have been stored as 3 separate SQLite rows
    const textMsgs = messages.filter((m) => m.type === 'text');
    expect(textMsgs).toHaveLength(3);

    // Simulate session restore from SQLite
    useChatStore.getState().restoreMessages('cop-restore', textMsgs);

    const task = useChatStore.getState().tasks.get('cop-restore')!;

    console.log('\n=== E2E: RESTORE MESSAGES ===');
    for (const [i, m] of task.messages.entries()) {
      console.log(`  [${i}] type=${m.type} content=${JSON.stringify(m.content)}`);
    }

    // CRITICAL: should be ONE message after restore, not three
    const storeMsgs = task.messages.filter((m) => m.type === 'text');
    expect(storeMsgs).toHaveLength(1);
    expect(storeMsgs[0].content).toBe('Hello beautiful world');
  });
});
