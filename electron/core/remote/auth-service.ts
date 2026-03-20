import crypto from 'crypto';
import os from 'os';
import { getDb } from '../db/connection';
import { logDiagnostic } from '../diagnostics/logger';
import type { RemoteClientInfo, RemotePairingCode } from './protocol';
import { generateOpaqueSecret, hashSecret, maskSecret, secretEquals } from './secure-store';

const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS_PER_ADDRESS = 10;

interface PairingRow {
  id: string;
  code_hash: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

interface ClientRow {
  id: string;
  client_name: string;
  token_hash: string;
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
  private readonly attemptWindow = new Map<string, number[]>();
  private activePairingCode: RemotePairingCode | null = null;

  createPairingCode(ttlMs: number = DEFAULT_PAIRING_TTL_MS): RemotePairingCode {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const code = this.generatePairingCode();
    const id = crypto.randomUUID();

    const db = getDb();
    db.prepare(
      `INSERT INTO remote_pairing_sessions (id, code_hash, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(id, hashSecret(code), now, expiresAt);

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
         ORDER BY updated_at DESC`,
      )
      .all() as Array<Omit<ClientRow, 'token_hash'>>;

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

    if (remoteAddress) {
      this.recordAttempt(remoteAddress);
    }

    const db = getDb();
    const clients = db
      .prepare(
        `SELECT id, client_name, token_hash, token_preview, created_at, updated_at, last_seen_at, revoked_at, last_address
         FROM remote_clients
         WHERE revoked_at IS NULL`,
      )
      .all() as unknown as ClientRow[];

    for (const row of clients) {
      if (!secretEquals(trimmed, row.token_hash)) continue;
      const now = Date.now();
      const nextName = clientName?.trim() || row.client_name;
      db.prepare(
        `UPDATE remote_clients
         SET client_name = ?, updated_at = ?, last_seen_at = ?, last_address = ?
         WHERE id = ?`,
      ).run(nextName, now, now, remoteAddress ?? row.last_address, row.id);

      this.clearAttempts(remoteAddress);

      return {
        client: {
          id: row.id,
          clientName: nextName,
          tokenPreview: row.token_preview,
          createdAt: row.created_at,
          updatedAt: now,
          lastSeenAt: now,
          revokedAt: row.revoked_at,
          lastAddress: remoteAddress ?? row.last_address,
        },
        token: trimmed,
        upgradedFromPairingCode: false,
      };
    }

    const pairings = db
      .prepare(
        `SELECT id, code_hash, created_at, expires_at, consumed_at
         FROM remote_pairing_sessions
         WHERE consumed_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
      .all(Date.now()) as unknown as PairingRow[];

    for (const pairing of pairings) {
      if (!secretEquals(trimmed, pairing.code_hash)) continue;
      const result = this.createClient(
        clientName?.trim() || `Flux Mobile (${os.hostname()})`,
        undefined,
        remoteAddress,
      );
      db.prepare(
        `UPDATE remote_pairing_sessions
         SET consumed_at = ?
         WHERE id = ?`,
      ).run(Date.now(), pairing.id);

      this.clearAttempts(remoteAddress);

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

    throw new Error('Invalid or expired remote token');
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
        id, client_name, token_hash, token_preview, created_at, updated_at, last_seen_at, revoked_at, last_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      clientName,
      hashSecret(durableToken),
      tokenPreview,
      now,
      now,
      now,
      remoteAddress ?? null,
    );

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

  private recordAttempt(remoteAddress: string): void {
    const now = Date.now();
    const attempts = (this.attemptWindow.get(remoteAddress) ?? [])
      .filter((timestamp) => now - timestamp < PAIRING_ATTEMPT_WINDOW_MS);
    attempts.push(now);
    this.attemptWindow.set(remoteAddress, attempts);
    if (attempts.length > MAX_PAIRING_ATTEMPTS_PER_ADDRESS) {
      throw new Error('Too many pairing attempts, try again later');
    }
  }

  private clearAttempts(remoteAddress?: string | null): void {
    if (!remoteAddress) return;
    this.attemptWindow.delete(remoteAddress);
  }
}
