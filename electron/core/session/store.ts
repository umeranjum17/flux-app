import crypto from 'crypto';
import { getDb } from '../db/connection';
import { Session, SessionMessage } from './types';

export class SessionStore {
  list(): Session[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all() as any[];
    return rows.map(rowToSession);
  }

  get(id: string): Session | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    return row ? rowToSession(row) : null;
  }

  create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO sessions (id, title, agent_id, model, mode, cwd, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.title,
      data.agentId,
      data.model,
      data.mode,
      data.cwd,
      now,
      now,
      JSON.stringify(data.metadata ?? {})
    );

    return { ...data, id, createdAt: now, updatedAt: now, metadata: data.metadata ?? {} };
  }

  update(id: string, updates: Partial<Session>): void {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.agentId !== undefined) {
      fields.push('agent_id = ?');
      values.push(updates.agentId);
    }
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model);
    }
    if (updates.mode !== undefined) {
      fields.push('mode = ?');
      values.push(updates.mode);
    }
    if (updates.cwd !== undefined) {
      fields.push('cwd = ?');
      values.push(updates.cwd);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  addMessage(
    sessionId: string,
    message: Omit<SessionMessage, 'id' | 'timestamp' | 'sessionId'>
  ): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (session_id, role, type, content, tool_name, tool_input, tool_call_id, cost_usd, input_tokens, output_tokens, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      message.role,
      message.type,
      message.content,
      message.toolName,
      typeof message.toolInput === 'string'
        ? message.toolInput
        : message.toolInput
          ? JSON.stringify(message.toolInput)
          : null,
      message.toolCallId,
      message.costUsd,
      message.inputTokens,
      message.outputTokens,
      Date.now()
    );

    // Update session's updated_at
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);
  }

  getMessages(sessionId: string): SessionMessage[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId) as any[];
    return rows.map(rowToMessage);
  }
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agent_id,
    model: row.model,
    mode: row.mode,
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function rowToMessage(row: any): SessionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    type: row.type,
    content: row.content,
    toolName: row.tool_name,
    toolInput: row.tool_input,
    toolCallId: row.tool_call_id,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    timestamp: row.timestamp,
  };
}
