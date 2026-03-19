/**
 * Simulates the exact message sequence a Copilot CLI session produces
 * after the main-process delta-buffering layer (copilot.ts flushDeltas)
 * and IPC relay have processed the NDJSON stream. The messages tested
 * here are what the renderer's useAgentStream hook feeds into the store
 * via ingestStreamBatch / ingestStreamMessage.
 *
 * Goal: verify that consecutive text / thinking chunks merge into a
 * single message bubble instead of creating separate entries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chat';
import type { AgentMessage } from '../../lib/types';

function makeTask(id = 'cop-1') {
  useChatStore.getState().createTask({
    id,
    title: 'Copilot stream test',
    agentId: 'copilot',
    model: 'gpt-4o',
    mode: 'act',
    thinking: 'medium',
    cwd: '/tmp',
  });
}

function msgs(taskId = 'cop-1') {
  return useChatStore.getState().tasks.get(taskId)!.messages;
}

function task(taskId = 'cop-1') {
  return useChatStore.getState().tasks.get(taskId)!;
}

// Helper: build a text chunk as emitted by copilot.ts flushDeltas
function text(content: string, ts = Date.now()): AgentMessage {
  return { type: 'text', role: 'assistant', content, timestamp: ts };
}

function thinking(content: string, ts = Date.now()): AgentMessage {
  return { type: 'thinking', role: 'assistant', content, timestamp: ts };
}

function status(content: string, ts = Date.now()): AgentMessage {
  return { type: 'status', role: 'system', statusKind: 'progress', content, timestamp: ts };
}

function toolCall(name: string, id: string, ts = Date.now()): AgentMessage {
  return { type: 'tool_call', role: 'assistant', content: `Using tool: ${name}`, timestamp: ts, toolName: name, toolInput: {}, toolCallId: id };
}

function toolResult(id: string, content: string, ts = Date.now()): AgentMessage {
  return { type: 'tool_result', role: 'tool', content, timestamp: ts, toolCallId: id };
}

function result(ts = Date.now()): AgentMessage {
  return { type: 'result', role: 'assistant', content: '', timestamp: ts, inputTokens: 500, outputTokens: 200 };
}

beforeEach(() => {
  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
});

// ---------------------------------------------------------------------------
// 1. Basic delta merge via ingestStreamMessage (one at a time)
// ---------------------------------------------------------------------------
describe('Copilot stream: basic merge (ingestStreamMessage)', () => {
  it('merges consecutive text chunks into one message', () => {
    makeTask();
    const { ingestStreamMessage } = useChatStore.getState();
    ingestStreamMessage('cop-1', text('Hello'));
    ingestStreamMessage('cop-1', text(' world'));
    ingestStreamMessage('cop-1', text('!'));

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Hello world!');
  });

  it('merges consecutive thinking chunks into one message', () => {
    makeTask();
    const { ingestStreamMessage } = useChatStore.getState();
    ingestStreamMessage('cop-1', thinking('Let me'));
    ingestStreamMessage('cop-1', thinking(' think'));
    ingestStreamMessage('cop-1', thinking('...'));

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Let me think...');
    expect(msgs()[0].type).toBe('thinking');
  });
});

// ---------------------------------------------------------------------------
// 2. Batch merge via ingestStreamBatch (realistic RAF flush path)
// ---------------------------------------------------------------------------
describe('Copilot stream: batch merge (ingestStreamBatch)', () => {
  it('merges text chunks within a single batch', () => {
    makeTask();
    useChatStore.getState().ingestStreamBatch([
      { taskId: 'cop-1', message: text('Hello') },
      { taskId: 'cop-1', message: text(' world') },
      { taskId: 'cop-1', message: text('!') },
    ]);

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Hello world!');
  });

  it('merges text chunks across multiple batches', () => {
    makeTask();
    useChatStore.getState().ingestStreamBatch([
      { taskId: 'cop-1', message: text('Hello') },
    ]);
    useChatStore.getState().ingestStreamBatch([
      { taskId: 'cop-1', message: text(' world') },
    ]);
    useChatStore.getState().ingestStreamBatch([
      { taskId: 'cop-1', message: text('!') },
    ]);

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Hello world!');
  });
});

// ---------------------------------------------------------------------------
// 3. Status messages must NOT break the text merge chain
// ---------------------------------------------------------------------------
describe('Copilot stream: status messages interleaved', () => {
  it('status messages between text chunks do not create separate bubbles', () => {
    makeTask();
    const store = useChatStore.getState();

    // Simulate: text flush → heartbeat status → text flush → status → text flush
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text('Hello') },
      { taskId: 'cop-1', message: status('Copilot is working...') },
      { taskId: 'cop-1', message: text(' world') },
      { taskId: 'cop-1', message: status('Still working...') },
      { taskId: 'cop-1', message: text('!') },
    ]);

    // Status messages should NOT be in the messages array
    const textMessages = msgs().filter((m) => m.type === 'text');
    expect(textMessages).toHaveLength(1);
    expect(textMessages[0].content).toBe('Hello world!');

    // No status messages in the array
    expect(msgs().filter((m) => m.type === 'status')).toHaveLength(0);

    // Status should be tracked separately
    expect(task().currentStatus).toBe('Still working...');
  });

  it('status messages between batches do not break merge', () => {
    makeTask();
    const store = useChatStore.getState();

    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text('Hello') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: status('heartbeat') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text(' world') },
    ]);

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// 4. Full Copilot session simulation
//    Simulates the complete event sequence after copilot.ts delta buffering:
//    thinking → text → tool_call → tool_result → more text → result
// ---------------------------------------------------------------------------
describe('Copilot stream: full session simulation', () => {
  it('produces the expected merged message sequence', () => {
    makeTask();
    const store = useChatStore.getState();

    // --- Turn 1: thinking phase ---
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: thinking('Let me analyze') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: thinking(' the codebase...') },
    ]);

    // --- Turn 1: text phase ---
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text('I\'ll fix the bug ') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: status('Working...') },
      { taskId: 'cop-1', message: text('in `src/app.ts`.') },
    ]);

    // --- Tool execution ---
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: toolCall('edit_file', 'tc-1') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: status('Running tool: edit_file...') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: toolResult('tc-1', 'File edited successfully') },
    ]);

    // --- Turn 2: more thinking + text after tool ---
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: thinking('Now let me verify') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: thinking(' the change.') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text('I\'ve made') },
    ]);
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text(' the changes.') },
    ]);

    // --- Result ---
    store.ingestStreamBatch([
      { taskId: 'cop-1', message: result() },
    ]);

    // Verify: should be exactly 7 messages (not 12+)
    const m = msgs();
    expect(m.map((msg) => `${msg.type}:${msg.role}`)).toEqual([
      'thinking:assistant',   // "Let me analyze the codebase..."
      'text:assistant',       // "I'll fix the bug in `src/app.ts`."
      'tool_call:assistant',  // edit_file
      'tool_result:tool',     // "File edited successfully"
      'thinking:assistant',   // "Now let me verify the change."
      'text:assistant',       // "I've made the changes."
      'result:assistant',     // completion
    ]);

    // Verify merged content
    expect(m[0].content).toBe('Let me analyze the codebase...');
    expect(m[1].content).toBe('I\'ll fix the bug in `src/app.ts`.');
    expect(m[4].content).toBe('Now let me verify the change.');
    expect(m[5].content).toBe('I\'ve made the changes.');
  });
});

// ---------------------------------------------------------------------------
// 5. High-frequency delta simulation (many small chunks like real Copilot)
// ---------------------------------------------------------------------------
describe('Copilot stream: high-frequency token-level deltas', () => {
  it('merges many small text chunks into one message', () => {
    makeTask();
    const store = useChatStore.getState();

    // Simulate 50 token-level flushes (what happens with fast typing)
    const tokens = 'The quick brown fox jumps over the lazy dog '.split(' ');
    for (const token of tokens) {
      store.ingestStreamBatch([
        { taskId: 'cop-1', message: text(token + ' ') },
      ]);
    }

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe(tokens.map((t) => t + ' ').join(''));
  });

  it('merges chunks even with frequent status heartbeats interleaved', () => {
    makeTask();
    const store = useChatStore.getState();

    // Simulate: text, status, text, status, text, status, text...
    const words = ['Hello', ' beautiful', ' world', ' this', ' is', ' a', ' test'];
    for (let i = 0; i < words.length; i++) {
      store.ingestStreamBatch([
        { taskId: 'cop-1', message: text(words[i]) },
        { taskId: 'cop-1', message: status(`heartbeat-${i}`) },
      ]);
    }

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].content).toBe('Hello beautiful world this is a test');
  });
});

// ---------------------------------------------------------------------------
// 6. restoreMessages — the persistence round-trip path
//    When a session is reloaded, stored text chunks must also merge.
// ---------------------------------------------------------------------------
describe('Copilot stream: restoreMessages merges text chunks', () => {
  it('merges consecutive stored text chunks on restore', () => {
    makeTask();
    useChatStore.getState().setTaskStatus('cop-1', 'done');

    // Simulate what SQLite stored: many individual text rows
    useChatStore.getState().restoreMessages('cop-1', [
      text('Hello', 1),
      text(' world', 2),
      text('!', 3),
    ]);

    // These SHOULD be merged into one message
    const textMsgs = msgs().filter((m) => m.type === 'text');
    expect(textMsgs).toHaveLength(1);
    expect(textMsgs[0].content).toBe('Hello world!');
  });

  it('preserves proper breaks (tool calls) during restore', () => {
    makeTask();
    useChatStore.getState().setTaskStatus('cop-1', 'done');

    useChatStore.getState().restoreMessages('cop-1', [
      text('Plan:', 1),
      text(' edit the file.', 2),
      toolCall('edit_file', 'tc-1', 3),
      toolResult('tc-1', 'done', 4),
      text('I\'ve made', 5),
      text(' the changes.', 6),
      result(7),
    ]);

    expect(msgs().map((m) => m.type)).toEqual([
      'text',        // "Plan: edit the file."  (merged)
      'tool_call',
      'tool_result',
      'text',        // "I've made the changes."  (merged)
      'result',
    ]);

    expect(msgs()[0].content).toBe('Plan: edit the file.');
    expect(msgs()[3].content).toBe('I\'ve made the changes.');
  });
});

describe('Copilot stream: authoritative empty replacements', () => {
  it('clears a garbled Copilot delta bubble when the final content is intentionally empty', () => {
    makeTask();
    const store = useChatStore.getState();

    store.ingestStreamBatch([
      { taskId: 'cop-1', message: text('Dependenciesaremissing') },
      {
        taskId: 'cop-1',
        message: {
          ...text('', Date.now() + 1),
          replaceLastContent: true,
        },
      },
    ]);

    expect(msgs()).toHaveLength(1);
    expect(msgs()[0].type).toBe('text');
    expect(msgs()[0].content).toBe('');
  });
});
