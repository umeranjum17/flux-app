import crypto from 'crypto';
import os from 'os';
import { getDb } from '../db/connection';
import { logDiagnostic } from '../diagnostics/logger';
import type { RemoteClientInfo, RemotePairingCode } from './protocol';
import { generateOpaqueSecret, maskSecret } from './secure-store';

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

interface PairingRow {
  id: string;
  code: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

interface ClientRow {
  id: string;
  client_name: string;
  token: string;
  token_preview: string;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  last_address: string | null;
}

export interface PairingResult {
  client: RemoteClientInfo;
  token: string;
  upgradedFromPairingCode: boolean;
}

export class RemoteAuthService {
  private activePairingCode: RemotePairingCode | null = null;
  createPairingCode(ttlMs: number = DEFAULT_PAIRING_TTL_MS): RemotePairingCode {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const code = this.generatePairingCode();
    const id = crypto.randomUUID();

    const db = getDb();
    db.prepare(
      `INSERT INTO remote_pairing_sessions (id, code, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(id, code, now, expiresAt);

    logDiagnostic('remote-auth', 'pairing code created', {
      pairingId: id,
      expiresAt,
    });

    this.activePairingCode = { code, expiresAt };
    return this.activePairingCode;
  }

  getActivePairingCode(): RemotePairingCode | null {
    if (!this.activePairingCode) {
      return null;
    }
    if (this.activePairingCode.expiresAt <= Date.now()) {
      this.activePairingCode = null;
      return null;
    }
    return this.activePairingCode;
  }

  listClients(): RemoteClientInfo[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, client_name, token_preview, created_at, updated_at, last_seen_at, revoked_at, last_address
         FROM remote_clients
         WHERE revoked_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all() as Array<Omit<ClientRow, 'token'>>;

    return rows.map((row) => ({
      id: row.id,
      clientName: row.client_name,
      tokenPreview: row.token_preview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      lastAddress: row.last_address,
    }));
  }

  countActiveClients(): number {
    const db = getDb();
    const row = db
      .prepare('SELECT COUNT(*) as count FROM remote_clients WHERE revoked_at IS NULL')
      .get() as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  revokeClient(clientId: string): void {
    const now = Date.now();
    const db = getDb();
    db.prepare(
      `UPDATE remote_clients
       SET revoked_at = ?, updated_at = ?
       WHERE id = ? AND revoked_at IS NULL`,
    ).run(now, now, clientId);

    logDiagnostic('remote-auth', 'client revoked', { clientId });
  }

  authenticateToken(token: string, clientName?: string, remoteAddress?: string | null): PairingResult {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error('Token is required');
    }

    const db = getDb();

    // Check existing clients first (reconnection with saved token)
    const client = db
      .prepare(
        `SELECT id, client_name, token, token_preview, created_at, updated_at, last_seen_at, revoked_at, last_address
         FROM remote_clients
         WHERE token = ? AND revoked_at IS NULL`,
      )
      .get(trimmed) as ClientRow | undefined;

    if (client) {
      const now = Date.now();
      const nextName = clientName?.trim() || client.client_name;
      db.prepare(
        `UPDATE remote_clients
         SET client_name = ?, updated_at = ?, last_seen_at = ?, last_address = ?
         WHERE id = ?`,
      ).run(nextName, now, now, remoteAddress ?? client.last_address, client.id);

      return {
        client: {
          id: client.id,
          clientName: nextName,
          tokenPreview: client.token_preview,
          createdAt: client.created_at,
          updatedAt: now,
          lastSeenAt: now,
          revokedAt: client.revoked_at,
          lastAddress: remoteAddress ?? client.last_address,
        },
        token: trimmed,
        upgradedFromPairingCode: false,
      };
    }

    // Check if the token belongs to a revoked client
    const revokedClients = db
      .prepare(
        `SELECT id, token_hash FROM remote_clients WHERE revoked_at IS NOT NULL`,
      )
      .all() as unknown as Pick<ClientRow, 'id' | 'token_hash'>[];

    for (const row of revokedClients) {
      if (!secretEquals(trimmed, row.token_hash)) continue;
      throw new Error('Client has been revoked');
    }

    // Check pairing codes
    const pairing = db
      .prepare(
        `SELECT id, code, created_at, expires_at, consumed_at
         FROM remote_pairing_sessions
         WHERE code = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(trimmed, Date.now()) as PairingRow | undefined;

    if (pairing) {
      const result = this.createClient(
        clientName?.trim() || `Flux Mobile (${os.hostname()})`,
        undefined,
        remoteAddress,
      );
      db.prepare(
        `UPDATE remote_pairing_sessions SET consumed_at = ? WHERE id = ?`,
      ).run(Date.now(), pairing.id);

      logDiagnostic('remote-auth', 'pairing code consumed', {
        pairingId: pairing.id,
        clientId: result.client.id,
      });

      if (this.activePairingCode?.code === trimmed) {
        this.activePairingCode = null;
      }

      return {
        ...result,
        upgradedFromPairingCode: true,
      };
    }

    throw new Error('Invalid token');
  }

  private createClient(
    clientName: string,
    token?: string,
    remoteAddress?: string | null,
  ): PairingResult {
    const db = getDb();
    const now = Date.now();
    const id = crypto.randomUUID();
    const durableToken = token || generateOpaqueSecret();
    const tokenPreview = maskSecret(durableToken);

    db.prepare(
      `INSERT INTO remote_clients (
        id, client_name, token, token_preview, created_at, updated_at, last_seen_at, revoked_at, last_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, clientName, durableToken, tokenPreview, now, now, now, remoteAddress ?? null);

    logDiagnostic('remote-auth', 'remote client created', {
      clientId: id,
      clientName,
      tokenPreview,
    });

    return {
      client: {
        id,
        clientName,
        tokenPreview,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        revokedAt: null,
        lastAddress: remoteAddress ?? null,
      },
      token: durableToken,
      upgradedFromPairingCode: false,
    };
  }

  private generatePairingCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      if (i > 0 && i % 4 === 0) code += '-';
      code += alphabet[randomBytes[i] % alphabet.length];
    }
    return code;
  }
}
