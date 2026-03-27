import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshotRows: any[] = [];

function createFsMock(readFileSync: (filePath: string) => string) {
  return {
    default: {
      existsSync: () => false,
      mkdirSync: () => {},
      statSync: () => {
        throw new Error('ENOENT');
      },
      renameSync: () => {},
      appendFileSync: () => {},
      readFileSync,
      writeFileSync: () => {},
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  snapshotRows.length = 0;
  vi.unstubAllGlobals();
});

describe('LiveUsageService', () => {
  it('fetches Claude and Codex live usage and records snapshots for the chart', async () => {
    vi.doMock('../../db/connection', () => ({
      getDb: () => ({
        prepare: (sql: string) => {
          if (sql.includes('INSERT INTO usage_window_snapshots')) {
            return {
              run: (...args: any[]) => {
                snapshotRows.push({
                  provider_id: args[0],
                  window_key: args[1],
                  sampled_at: args[2],
                  used_percent: args[3],
                  resets_at: args[4],
                  used_value: args[5],
                  limit_value: args[6],
                  remaining_value: args[7],
                  unit: args[8],
                  source: args[9],
                });
              },
            };
          }

          if (sql.includes('DELETE FROM usage_window_snapshots')) {
            return { run: () => {} };
          }

          if (sql.includes('FROM usage_window_snapshots')) {
            return {
              all: (...args: any[]) => {
                if (sql.includes('WHERE sampled_at >= ?')) {
                  return snapshotRows.filter((row) => row.sampled_at >= args[0]);
                }
                return [...snapshotRows].sort((left, right) => right.sampled_at - left.sampled_at);
              },
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    }));

    vi.doMock('fs', () => createFsMock((filePath: string) => {
      if (filePath.endsWith('.claude/.credentials.json')) {
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: 'claude-access',
            refreshToken: 'claude-refresh',
            expiresAt: Date.now() + 60_000,
          },
        });
      }

      if (filePath.endsWith('.codex/auth.json')) {
        return JSON.stringify({
          tokens: {
            access_token: 'codex-access',
            refresh_token: 'codex-refresh',
            account_id: 'account-123',
          },
          last_refresh: new Date().toISOString(),
        });
      }

      throw new Error(`Unexpected file read: ${filePath}`);
    }));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.anthropic.com/api/oauth/usage')) {
        return {
          ok: true,
          json: async () => ({
            five_hour: { utilization: 0.4, resets_at: '2026-03-09T20:00:00Z' },
            seven_day: { utilization: 0.7, resets_at: '2026-03-14T20:00:00Z' },
          }),
        };
      }

      if (url.includes('backend-api/wham/usage')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rate_limit: {
              primary_window: {
                used_percent: 65,
                reset_at: 1_778_092_800,
                limit_window_seconds: 18_000,
                limit: 100,
                remaining: 35,
              },
              secondary_window: {
                used_percent: 20,
                reset_at: 1_778_438_400,
                limit_window_seconds: 604_800,
                limit: 100,
                remaining: 80,
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const { LiveUsageService } = await import('../live');
    const overview = await new LiveUsageService().getOverview();

    expect(overview.providers).toHaveLength(2);
    expect(overview.providers[0]?.windows).toHaveLength(2);
    expect(overview.providers[1]?.windows).toHaveLength(2);
    expect(snapshotRows).toHaveLength(4);
    expect(overview.history).toHaveLength(4);
  });

  it('falls back to the latest snapshot when live fetch fails', async () => {
    snapshotRows.push({
      provider_id: 'claude-code',
      window_key: 'five_hour',
      sampled_at: Date.now() - 60_000,
      used_percent: 0.55,
      resets_at: Date.now() + 60_000,
      used_value: null,
      limit_value: null,
      remaining_value: null,
      unit: 'percent',
      source: 'live',
    });

    vi.doMock('../../db/connection', () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (...args: any[]) => {
            if (sql.includes('WHERE sampled_at >= ?')) {
              return snapshotRows.filter((row) => row.sampled_at >= args[0]);
            }
            return [...snapshotRows].sort((left, right) => right.sampled_at - left.sampled_at);
          },
          run: (...args: any[]) => {
            if (sql.includes('INSERT INTO usage_window_snapshots')) {
              snapshotRows.push({
                provider_id: args[0],
                window_key: args[1],
                sampled_at: args[2],
                used_percent: args[3],
                resets_at: args[4],
                used_value: args[5],
                limit_value: args[6],
                remaining_value: args[7],
                unit: args[8],
                source: args[9],
              });
            }
          },
        }),
      }),
    }));

    vi.doMock('fs', () => createFsMock((filePath: string) => {
      if (filePath.endsWith('.claude/.credentials.json')) {
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: 'claude-access',
            refreshToken: 'claude-refresh',
            expiresAt: Date.now() + 60_000,
          },
        });
      }

      throw new Error(`Unexpected file read: ${filePath}`);
    }));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.anthropic.com/api/oauth/usage')) {
        throw new Error('network down');
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
      };
    }));

    const { LiveUsageService } = await import('../live');
    const overview = await new LiveUsageService().getOverview();
    const claude = overview.providers.find((provider) => provider.providerId === 'claude-code');

    expect(claude?.windows).toHaveLength(1);
    expect(claude?.windows[0]?.source).toBe('snapshot');
    expect(claude?.message).toContain('network down');
  });

  it('treats Claude as disconnected when account exists but oauth token file is missing', async () => {
    vi.doMock('../../db/connection', () => ({
      getDb: () => ({
        prepare: (_sql: string) => ({
          all: () => [],
          run: () => {},
        }),
      }),
    }));

    vi.doMock('child_process', () => ({
      execFileSync: () => '',
      spawnSync: () => ({
        status: 1,
        stdout: '',
        stderr: 'mocked keychain miss',
        error: null,
      }),
    }));

    vi.doMock('fs', () => createFsMock((filePath: string) => {
      if (filePath.endsWith('.claude.json')) {
        return JSON.stringify({
          oauthAccount: {
            accountUuid: 'account-1',
          },
        });
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    }));

    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const { LiveUsageService } = await import('../live');
    const overview = await new LiveUsageService().getOverview();
    const claude = overview.providers.find((provider) => provider.providerId === 'claude-code');

    expect(claude?.status).toBe('auth_missing');
    expect(claude?.message).toContain('token is unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('writes periodic anchor snapshots when usage is unchanged', async () => {
    const baseNow = Date.UTC(2026, 2, 10, 12, 0, 0);
    const resetAt = Date.UTC(2026, 2, 10, 20, 0, 0);
    snapshotRows.push(
      {
        provider_id: 'claude-code',
        window_key: 'five_hour',
        sampled_at: baseNow,
        used_percent: 0.004,
        resets_at: resetAt,
        used_value: null,
        limit_value: null,
        remaining_value: null,
        unit: 'percent',
        source: 'live',
      },
      {
        provider_id: 'claude-code',
        window_key: 'seven_day',
        sampled_at: baseNow,
        used_percent: 0.007,
        resets_at: resetAt,
        used_value: null,
        limit_value: null,
        remaining_value: null,
        unit: 'percent',
        source: 'live',
      },
    );

    vi.doMock('../../db/connection', () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          all: (...args: any[]) => {
            if (sql.includes('WHERE sampled_at >= ?')) {
              return snapshotRows.filter((row) => row.sampled_at >= args[0]);
            }
            return [...snapshotRows].sort((left, right) => right.sampled_at - left.sampled_at);
          },
          run: (...args: any[]) => {
            if (sql.includes('INSERT INTO usage_window_snapshots')) {
              snapshotRows.push({
                provider_id: args[0],
                window_key: args[1],
                sampled_at: args[2],
                used_percent: args[3],
                resets_at: args[4],
                used_value: args[5],
                limit_value: args[6],
                remaining_value: args[7],
                unit: args[8],
                source: args[9],
              });
            }
          },
        }),
      }),
    }));

    vi.doMock('fs', () => createFsMock((filePath: string) => {
      if (filePath.endsWith('.claude/.credentials.json')) {
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: 'claude-access',
            refreshToken: 'claude-refresh',
            expiresAt: baseNow + 60_000,
          },
        });
      }
      throw new Error(`Unexpected file read: ${filePath}`);
    }));

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.anthropic.com/api/oauth/usage')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            five_hour: { utilization: 0.4, resets_at: new Date(resetAt).toISOString() },
            seven_day: { utilization: 0.7, resets_at: new Date(resetAt).toISOString() },
          }),
        };
      }

      return {
        ok: false,
        status: 401,
        json: async () => ({}),
      };
    }));

    const { LiveUsageService } = await import('../live');
    const dateSpy = vi.spyOn(Date, 'now');
    const service = new LiveUsageService();

    dateSpy.mockReturnValue(baseNow + (4 * 60_000));
    await service.getOverview();
    expect(snapshotRows).toHaveLength(2);

    dateSpy.mockReturnValue(baseNow + (16 * 60_000));
    await service.getOverview();
    expect(snapshotRows).toHaveLength(4);
    dateSpy.mockRestore();
  });
});
