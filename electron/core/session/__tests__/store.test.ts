import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let db: DatabaseSync;

vi.mock('../../db/connection', () => ({
  getDb: () => db,
}));

import { SessionStore } from '../store';

describe('SessionStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        agent_id TEXT,
        model TEXT,
        mode TEXT,
        cwd TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        metadata TEXT
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT REFERENCES sessions(id),
        role TEXT,
        type TEXT,
        content TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_call_id TEXT,
        cost_usd REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        payload_json TEXT,
        timestamp INTEGER
      );
    `);
  });

  it('preserves insertion order when multiple messages share a timestamp', () => {
    const store = new SessionStore();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_717_171_717_171);
    const session = store.create({
      title: 'Copilot restore ordering',
      agentId: 'copilot',
      model: 'gpt-5.4',
      mode: 'act',
      cwd: '/tmp',
      metadata: {},
    });

    const sharedMessage = {
      role: 'assistant',
      type: 'text',
      toolName: null,
      toolInput: null,
      toolCallId: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      payloadJson: null,
    } as const;

    store.addMessage(session.id, { ...sharedMessage, content: 'Hello' });
    store.addMessage(session.id, { ...sharedMessage, content: ' beautiful' });
    store.addMessage(session.id, { ...sharedMessage, content: ' world' });

    nowSpy.mockRestore();

    expect(store.getMessages(session.id).map((message) => message.content)).toEqual([
      'Hello',
      ' beautiful',
      ' world',
    ]);
  });
});
