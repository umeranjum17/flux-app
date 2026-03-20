import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let db: DatabaseSync;

vi.mock('../../db/connection', () => ({
  getDb: () => db,
}));

vi.mock('../../diagnostics/logger', () => ({
  logDiagnostic: vi.fn(),
}));

import { RemoteAuthService } from '../auth-service';

describe('RemoteAuthService', () => {
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE remote_clients (
        id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_preview TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER,
        last_address TEXT
      );

      CREATE TABLE remote_pairing_sessions (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
    `);
  });

  it('creates pairing codes and upgrades them into remote clients', () => {
    const service = new RemoteAuthService();
    const pairing = service.createPairingCode(60_000);

    expect(pairing.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(pairing.expiresAt).toBeGreaterThan(Date.now());

    const auth = service.authenticateToken(pairing.code, 'Flux Mobile', '192.168.0.10');

    expect(auth.client.clientName).toBe('Flux Mobile');
    expect(auth.client.lastAddress).toBe('192.168.0.10');
    expect(auth.upgradedFromPairingCode).toBe(true);
    expect(auth.token).not.toBe(pairing.code);
    expect(service.listClients()).toHaveLength(1);
  });

  it('authenticates an existing durable token and updates last seen metadata', () => {
    const service = new RemoteAuthService();
    const pairing = service.createPairingCode(60_000);
    const created = service.authenticateToken(pairing.code, 'Flux Mobile', '192.168.0.10');

    const next = service.authenticateToken(created.token, 'Renamed Phone', '192.168.0.20');

    expect(next.upgradedFromPairingCode).toBe(false);
    expect(next.client.clientName).toBe('Renamed Phone');
    expect(next.client.lastAddress).toBe('192.168.0.20');
  });

  it('revokes clients so their tokens can no longer authenticate', () => {
    const service = new RemoteAuthService();
    const pairing = service.createPairingCode(60_000);
    const created = service.authenticateToken(pairing.code, 'Flux Mobile', '192.168.0.10');

    service.revokeClient(created.client.id);

    expect(() => service.authenticateToken(created.token, 'Flux Mobile', '192.168.0.10'))
      .toThrow('Invalid or expired remote token');
  });
});
