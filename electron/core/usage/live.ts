import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { getDb } from '../db/connection';

export type UsageProviderId = 'claude-code' | 'codex';
export type UsageWindowKey = 'five_hour' | 'seven_day';
export type UsageWindowSource = 'live' | 'stream_fallback' | 'snapshot';
export type UsageProviderStatus = 'connected' | 'auth_missing' | 'error';

export interface CachedRateLimitInfo {
  providerId: UsageProviderId;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt: number;
  rateLimitType: string;
  utilization: number;
  overageStatus?: string;
  overageResetsAt?: number;
  fetchedAt?: number;
}

export interface LiveUsageWindow {
  providerId: UsageProviderId;
  providerLabel: string;
  windowKey: UsageWindowKey;
  windowLabel: string;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  usedPercent: number;
  resetsAt: number | null;
  remainingMs: number | null;
  fetchedAt: number;
  source: UsageWindowSource;
  isStale: boolean;
  usedValue: number | null;
  limitValue: number | null;
  remainingValue: number | null;
  unit: string | null;
}

export interface LiveUsageProvider {
  providerId: UsageProviderId;
  label: string;
  status: UsageProviderStatus;
  fetchedAt: number | null;
  source: UsageWindowSource | null;
  message: string | null;
  windows: LiveUsageWindow[];
}

export interface UsageHistoryPoint {
  providerId: UsageProviderId;
  windowKey: UsageWindowKey;
  sampledAt: number;
  usedPercent: number;
  resetsAt: number | null;
  source: UsageWindowSource;
}

export interface LiveUsageOverview {
  providers: LiveUsageProvider[];
  history: UsageHistoryPoint[];
  updatedAt: number;
}

interface UsageSnapshotRow {
  provider_id: UsageProviderId;
  window_key: UsageWindowKey;
  sampled_at: number;
  used_percent: number;
  resets_at: number | null;
  used_value: number | null;
  limit_value: number | null;
  remaining_value: number | null;
  unit: string | null;
  source: UsageWindowSource;
}

interface InternalWindow {
  providerId: UsageProviderId;
  windowKey: UsageWindowKey;
  status: 'allowed' | 'allowed_warning' | 'rejected';
  usedPercent: number;
  resetsAt: number | null;
  fetchedAt: number;
  source: UsageWindowSource;
  usedValue?: number | null;
  limitValue?: number | null;
  remainingValue?: number | null;
  unit?: string | null;
}

interface ProviderFetchResult {
  providerId: UsageProviderId;
  label: string;
  status: UsageProviderStatus;
  message: string | null;
  fetchedAt: number | null;
  windows: InternalWindow[];
}

const CLAUDE_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const CLAUDE_STATE_PATH = path.join(os.homedir(), '.claude.json');
const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const CLAUDE_KEYCHAIN_SERVICES = [
  'Claude Code-credentials',
  'Claude Code',
];
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_TOKEN_URLS = [
  'https://console.anthropic.com/v1/oauth/token',
  'https://platform.claude.com/v1/oauth/token',
] as const;
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const WINDOW_LABELS: Record<UsageWindowKey, string> = {
  five_hour: '5h',
  seven_day: '7d',
};
const PROVIDER_LABELS: Record<UsageProviderId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const CLAUDE_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const CODEX_REFRESH_INTERVAL_MS = 8 * 24 * 60 * 60 * 1000;

export class LiveUsageService {
  async getOverview(cachedRateLimits: CachedRateLimitInfo[] = []): Promise<LiveUsageOverview> {
    const now = Date.now();
    const [claude, codex] = await Promise.all([
      this.fetchClaudeUsage(now),
      this.fetchCodexUsage(now),
    ]);

    this.persistSnapshots([...claude.windows, ...codex.windows].filter((window) => window.source === 'live'));

    const latestSnapshots = this.getLatestSnapshots();
    const providers = [
      this.resolveProvider(claude, latestSnapshots, cachedRateLimits, now),
      this.resolveProvider(codex, latestSnapshots, cachedRateLimits, now),
    ];

    this.pruneOldSnapshots(now);

    return {
      providers,
      history: this.getHistory(now - HISTORY_RETENTION_MS),
      updatedAt: now,
    };
  }

  private resolveProvider(
    result: ProviderFetchResult,
    latestSnapshots: Map<string, UsageSnapshotRow>,
    cachedRateLimits: CachedRateLimitInfo[],
    now: number,
  ): LiveUsageProvider {
    const liveWindows = result.windows.map((window) => this.toLiveWindow(result, window, false, now));
    if (liveWindows.length > 0) {
      return {
        providerId: result.providerId,
        label: result.label,
        status: result.status,
        fetchedAt: result.fetchedAt,
        source: 'live',
        message: result.message,
        windows: sortWindows(liveWindows),
      };
    }

    const snapshotWindows = (['five_hour', 'seven_day'] as UsageWindowKey[])
      .map((windowKey) => latestSnapshots.get(snapshotKey(result.providerId, windowKey)))
      .filter((row): row is UsageSnapshotRow => !!row)
      .map((row) => this.snapshotRowToWindow(result, row, now));

    if (snapshotWindows.length > 0) {
      return {
        providerId: result.providerId,
        label: result.label,
        status: result.status,
        fetchedAt: snapshotWindows[0]?.fetchedAt ?? null,
        source: 'snapshot',
        message: result.message ?? 'Showing last known usage',
        windows: sortWindows(snapshotWindows),
      };
    }

    const fallbackWindows = cachedRateLimits
      .filter((item) => item.providerId === result.providerId)
      .map((item) => this.cachedRateLimitToWindow(item, now));

    return {
      providerId: result.providerId,
      label: result.label,
      status: result.status,
      fetchedAt: fallbackWindows[0]?.fetchedAt ?? null,
      source: fallbackWindows.length > 0 ? 'stream_fallback' : null,
      message: result.message,
      windows: sortWindows(fallbackWindows),
    };
  }

  private getLatestSnapshots(): Map<string, UsageSnapshotRow> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT provider_id, window_key, sampled_at, used_percent, resets_at, used_value, limit_value, remaining_value, unit, source
      FROM usage_window_snapshots
      ORDER BY sampled_at DESC
    `).all() as unknown as UsageSnapshotRow[];

    const latest = new Map<string, UsageSnapshotRow>();
    for (const row of rows) {
      const key = snapshotKey(row.provider_id, row.window_key);
      if (!latest.has(key)) {
        latest.set(key, row);
      }
    }
    return latest;
  }

  private getHistory(fromTimestamp: number): UsageHistoryPoint[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT provider_id, window_key, sampled_at, used_percent, resets_at, source
      FROM usage_window_snapshots
      WHERE sampled_at >= ?
      ORDER BY sampled_at ASC
    `).all(fromTimestamp) as unknown as Array<{
      provider_id: UsageProviderId;
      window_key: UsageWindowKey;
      sampled_at: number;
      used_percent: number;
      resets_at: number | null;
      source: UsageWindowSource;
    }>;

    return rows.map((row) => ({
      providerId: row.provider_id,
      windowKey: row.window_key,
      sampledAt: row.sampled_at,
      usedPercent: clampPercent(row.used_percent),
      resetsAt: row.resets_at,
      source: row.source,
    }));
  }

  private persistSnapshots(windows: InternalWindow[]): void {
    if (windows.length === 0) {
      return;
    }

    const db = getDb();
    const latest = this.getLatestSnapshots();
    const insert = db.prepare(`
      INSERT INTO usage_window_snapshots
        (provider_id, window_key, sampled_at, used_percent, resets_at, used_value, limit_value, remaining_value, unit, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const window of windows) {
      const last = latest.get(snapshotKey(window.providerId as UsageProviderId, window.windowKey));
      const shouldSkip = last
        && Math.abs(window.fetchedAt - last.sampled_at) < SNAPSHOT_INTERVAL_MS
        && Math.abs(window.usedPercent - last.used_percent) < 0.001
        && (window.resetsAt ?? null) === last.resets_at;

      if (shouldSkip) {
        continue;
      }

      insert.run(
        window.providerId,
        window.windowKey,
        window.fetchedAt,
        window.usedPercent,
        window.resetsAt,
        window.usedValue ?? null,
        window.limitValue ?? null,
        window.remainingValue ?? null,
        window.unit ?? null,
        window.source,
      );
    }
  }

  private pruneOldSnapshots(now: number): void {
    const db = getDb();
    db.prepare('DELETE FROM usage_window_snapshots WHERE sampled_at < ?').run(now - HISTORY_RETENTION_MS);
  }

  private snapshotRowToWindow(result: ProviderFetchResult, row: UsageSnapshotRow, now: number): LiveUsageWindow {
    return {
      providerId: result.providerId,
      providerLabel: result.label,
      windowKey: row.window_key,
      windowLabel: WINDOW_LABELS[row.window_key],
      status: mapStatus(row.used_percent),
      usedPercent: clampPercent(row.used_percent),
      resetsAt: row.resets_at,
      remainingMs: row.resets_at ? Math.max(0, row.resets_at - now) : null,
      fetchedAt: row.sampled_at,
      source: 'snapshot',
      isStale: true,
      usedValue: row.used_value,
      limitValue: row.limit_value,
      remainingValue: row.remaining_value,
      unit: row.unit,
    };
  }

  private cachedRateLimitToWindow(item: CachedRateLimitInfo, now: number): LiveUsageWindow {
    const windowKey = toUsageWindowKey(item.rateLimitType);
    return {
      providerId: item.providerId,
      providerLabel: PROVIDER_LABELS[item.providerId],
      windowKey,
      windowLabel: WINDOW_LABELS[windowKey],
      status: item.status,
      usedPercent: clampPercent(item.utilization),
      resetsAt: item.resetsAt || null,
      remainingMs: item.resetsAt ? Math.max(0, item.resetsAt - now) : null,
      fetchedAt: item.fetchedAt ?? now,
      source: 'stream_fallback',
      isStale: true,
      usedValue: null,
      limitValue: null,
      remainingValue: null,
      unit: 'percent',
    };
  }

  private toLiveWindow(result: ProviderFetchResult, window: InternalWindow, isStale: boolean, now: number): LiveUsageWindow {
    return {
      providerId: result.providerId,
      providerLabel: result.label,
      windowKey: window.windowKey,
      windowLabel: WINDOW_LABELS[window.windowKey],
      status: window.status,
      usedPercent: clampPercent(window.usedPercent),
      resetsAt: window.resetsAt,
      remainingMs: window.resetsAt ? Math.max(0, window.resetsAt - now) : null,
      fetchedAt: window.fetchedAt,
      source: window.source,
      isStale,
      usedValue: window.usedValue ?? null,
      limitValue: window.limitValue ?? null,
      remainingValue: window.remainingValue ?? null,
      unit: window.unit ?? null,
    };
  }

  private async fetchClaudeUsage(now: number): Promise<ProviderFetchResult> {
    const credentialSource = readClaudeCredentialSource();
    const oauth = credentialSource?.oauth;
    if (!oauth || typeof oauth.accessToken !== 'string') {
      const hasClaudeAccount = hasClaudeAccountState();
      return {
        providerId: 'claude-code',
        label: PROVIDER_LABELS['claude-code'],
        status: 'auth_missing',
        message: hasClaudeAccount
          ? 'Claude account detected, but local OAuth usage token is unavailable. Run "claude auth login" to reconnect usage.'
          : `Missing Claude credentials at ${CLAUDE_CREDENTIALS_PATH}`,
        fetchedAt: null,
        windows: [],
      };
    }

    let accessToken = oauth.accessToken as string;
    let refreshToken = typeof oauth.refreshToken === 'string' ? oauth.refreshToken : null;
    let expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0;

    if (refreshToken && expiresAt > 0 && expiresAt - now <= CLAUDE_REFRESH_BUFFER_MS) {
      const refreshed = await this.refreshClaudeToken(refreshToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        expiresAt = refreshed.expiresAt;
        writeClaudeCredentialSource(credentialSource, {
          ...oauth,
          accessToken,
          refreshToken,
          expiresAt,
        });
      }
    }

    try {
      const response = await fetch(CLAUDE_USAGE_URL, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });

      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && refreshToken) {
          const refreshed = await this.refreshClaudeToken(refreshToken);
          if (refreshed) {
            accessToken = refreshed.accessToken;
            refreshToken = refreshed.refreshToken;
            expiresAt = refreshed.expiresAt;
            writeClaudeCredentialSource(credentialSource, {
              ...oauth,
              accessToken,
              refreshToken,
              expiresAt,
            });
            return this.fetchClaudeUsage(now);
          }
        }
        throw new Error(`Claude usage request failed (${response.status})`);
      }

      const json = await response.json() as Record<string, any>;
      return {
        providerId: 'claude-code',
        label: PROVIDER_LABELS['claude-code'],
        status: 'connected',
        message: null,
        fetchedAt: now,
        windows: [
          normalizeClaudeWindow('five_hour', json.five_hour, now),
          normalizeClaudeWindow('seven_day', json.seven_day, now),
        ].filter((window): window is InternalWindow => !!window),
      };
    } catch (error) {
      return {
        providerId: 'claude-code',
        label: PROVIDER_LABELS['claude-code'],
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to fetch Claude usage',
        fetchedAt: null,
        windows: [],
      };
    }
  }

  private async refreshClaudeToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
    for (const tokenUrl of CLAUDE_TOKEN_URLS) {
      try {
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: CLAUDE_CLIENT_ID,
            refresh_token: refreshToken,
          }),
        });

        if (!response.ok) {
          continue;
        }

        const json = await response.json() as Record<string, any>;
        const accessToken = typeof json.access_token === 'string' ? json.access_token : null;
        if (!accessToken) {
          continue;
        }

        const nextRefreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken;
        const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
        return {
          accessToken,
          refreshToken: nextRefreshToken,
          expiresAt: Date.now() + (expiresIn * 1000),
        };
      } catch {
        // Keep trying the next known endpoint.
      }
    }
    return null;
  }

  private async fetchCodexUsage(now: number): Promise<ProviderFetchResult> {
    const auth = readJsonFile(CODEX_AUTH_PATH);
    const tokens = auth?.tokens;
    if (!tokens || typeof tokens.access_token !== 'string') {
      return {
        providerId: 'codex',
        label: PROVIDER_LABELS.codex,
        status: 'auth_missing',
        message: `Missing Codex credentials at ${CODEX_AUTH_PATH}`,
        fetchedAt: null,
        windows: [],
      };
    }

    let accessToken = tokens.access_token as string;
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null;
    const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : null;
    const lastRefresh = parseLastRefresh(auth.last_refresh);

    if (refreshToken && shouldRefreshCodexToken(lastRefresh, now)) {
      const refreshed = await this.refreshCodexToken(refreshToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        writeJsonFile(CODEX_AUTH_PATH, {
          ...auth,
          tokens: {
            ...tokens,
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            id_token: refreshed.idToken ?? tokens.id_token,
          },
          last_refresh: new Date(now).toISOString(),
        });
      }
    }

    try {
      const response = await fetch(CODEX_USAGE_URL, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
        },
      });

      if ((response.status === 401 || response.status === 403) && refreshToken) {
        const refreshed = await this.refreshCodexToken(refreshToken);
        if (refreshed) {
          accessToken = refreshed.accessToken;
          writeJsonFile(CODEX_AUTH_PATH, {
            ...auth,
            tokens: {
              ...tokens,
              access_token: refreshed.accessToken,
              refresh_token: refreshed.refreshToken,
              id_token: refreshed.idToken ?? tokens.id_token,
            },
            last_refresh: new Date(now).toISOString(),
          });
          return this.fetchCodexUsage(now);
        }
      }

      if (!response.ok) {
        throw new Error(`Codex usage request failed (${response.status})`);
      }

      const json = await response.json() as Record<string, any>;
      const windows = normalizeCodexWindows(json, now);
      return {
        providerId: 'codex',
        label: PROVIDER_LABELS.codex,
        status: 'connected',
        message: null,
        fetchedAt: now,
        windows,
      };
    } catch (error) {
      return {
        providerId: 'codex',
        label: PROVIDER_LABELS.codex,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to fetch Codex usage',
        fetchedAt: null,
        windows: [],
      };
    }
  }

  private async refreshCodexToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; idToken?: string } | null> {
    try {
      const response = await fetch(CODEX_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CODEX_CLIENT_ID,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json() as Record<string, any>;
      const accessToken = typeof json.access_token === 'string' ? json.access_token : null;
      if (!accessToken) {
        return null;
      }

      return {
        accessToken,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken,
        idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
      };
    } catch {
      return null;
    }
  }
}

function normalizeClaudeWindow(windowKey: UsageWindowKey, raw: any, now: number): InternalWindow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const usedPercent = clampPercent(normalizePercent(raw.utilization));
  const resetsAt = parseClaudeTimestamp(raw.resets_at);

  return {
    providerId: 'claude-code',
    windowKey,
    status: mapStatus(usedPercent),
    usedPercent,
    resetsAt,
    fetchedAt: now,
    source: 'live',
    unit: 'percent',
  };
}

function normalizeCodexWindows(raw: Record<string, any>, now: number): InternalWindow[] {
  const rateLimit = raw.rate_limit ?? raw.rate_limits ?? {};
  const windows = [
    normalizeCodexWindow(rateLimit.primary_window, now),
    normalizeCodexWindow(rateLimit.secondary_window, now),
  ].filter((window): window is InternalWindow => !!window);

  return windows.sort((left, right) => windowOrder(left.windowKey) - windowOrder(right.windowKey));
}

function normalizeCodexWindow(raw: any, now: number): InternalWindow | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const seconds = typeof raw.limit_window_seconds === 'number' ? raw.limit_window_seconds : null;
  const windowKey = seconds === 604800 ? 'seven_day' : 'five_hour';
  const usedPercent = clampPercent(normalizePercent(raw.used_percent));
  const limitValue = typeof raw.limit === 'number' ? raw.limit : null;
  const remainingValue = typeof raw.remaining === 'number' ? raw.remaining : null;
  const usedValue = limitValue !== null && remainingValue !== null ? limitValue - remainingValue : null;

  return {
    providerId: 'codex',
    windowKey,
    status: mapStatus(usedPercent),
    usedPercent,
    resetsAt: typeof raw.reset_at === 'number' ? raw.reset_at * 1000 : null,
    fetchedAt: now,
    source: 'live',
    usedValue,
    limitValue,
    remainingValue,
    unit: 'percent',
  };
}

function parseClaudeTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizePercent(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  if (value > 1) {
    return value / 100;
  }

  return value;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mapStatus(percent: number): 'allowed' | 'allowed_warning' | 'rejected' {
  if (percent >= 1) return 'rejected';
  if (percent >= 0.8) return 'allowed_warning';
  return 'allowed';
}

function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Best effort. If this fails, the current process still has fresh tokens in memory.
  }
}

function parseLastRefresh(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

function shouldRefreshCodexToken(lastRefresh: number, now: number): boolean {
  if (!lastRefresh) {
    return true;
  }
  return now - lastRefresh >= CODEX_REFRESH_INTERVAL_MS;
}

function toUsageWindowKey(rateLimitType: string): UsageWindowKey {
  return rateLimitType === 'seven_day' ? 'seven_day' : 'five_hour';
}

function sortWindows<T extends { windowKey: UsageWindowKey }>(windows: T[]): T[] {
  return [...windows].sort((left, right) => windowOrder(left.windowKey) - windowOrder(right.windowKey));
}

function windowOrder(windowKey: UsageWindowKey): number {
  return windowKey === 'five_hour' ? 0 : 1;
}

function snapshotKey(providerId: UsageProviderId, windowKey: UsageWindowKey): string {
  return `${providerId}:${windowKey}`;
}

interface ClaudeOauthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

interface ClaudeCredentialSource {
  path: string;
  data: Record<string, unknown>;
  oauth: ClaudeOauthTokens | null;
}

function readClaudeCredentialSource(): ClaudeCredentialSource | null {
  const candidates = [
    CLAUDE_CREDENTIALS_PATH,
    CLAUDE_STATE_PATH,
  ];

  for (const filePath of candidates) {
    const credentials = readJsonFile(filePath);
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      continue;
    }
    const parsed = parseClaudeOauthShape(credentials as Record<string, unknown>);
    if (!parsed) {
      continue;
    }
    return { path: filePath, data: credentials as Record<string, unknown>, oauth: parsed };
  }

  const keychainOauth = readClaudeOauthFromKeychain();
  if (keychainOauth) {
    return {
      path: 'macos-keychain',
      data: {},
      oauth: keychainOauth,
    };
  }

  return null;
}

function writeClaudeCredentialSource(source: ClaudeCredentialSource | null, oauth: ClaudeOauthTokens): void {
  if (!source) {
    return;
  }
  if (source.path === 'macos-keychain') {
    return;
  }
  const nextData = {
    ...source.data,
    claudeAiOauth: {
      ...(typeof source.data.claudeAiOauth === 'object' && source.data.claudeAiOauth
        ? source.data.claudeAiOauth as Record<string, unknown>
        : {}),
      accessToken: oauth.accessToken,
      ...(oauth.refreshToken ? { refreshToken: oauth.refreshToken } : {}),
      expiresAt: oauth.expiresAt,
    },
  };
  writeJsonFile(source.path, nextData);
}

function parseClaudeOauthShape(raw: Record<string, unknown>): ClaudeOauthTokens | null {
  const oauthCandidate = raw.claudeAiOauth;
  if (!oauthCandidate || typeof oauthCandidate !== 'object' || Array.isArray(oauthCandidate)) {
    return null;
  }
  const oauth = oauthCandidate as Record<string, unknown>;
  const accessToken = pickString(oauth.accessToken, oauth.access_token, oauth.token);
  if (!accessToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken: pickString(oauth.refreshToken, oauth.refresh_token) ?? null,
    expiresAt: pickNumber(oauth.expiresAt, oauth.expires_at, oauth.expiry) ?? 0,
  };
}

function readClaudeOauthFromKeychain(): ClaudeOauthTokens | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  for (const service of CLAUDE_KEYCHAIN_SERVICES) {
    const output = readMacKeychainService(service);
    if (!output) {
      continue;
    }

    const parsed = parseClaudeKeychainOutput(output);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function readMacKeychainService(service: string): string | null {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf-8' },
    ).trim();
  } catch {
    return null;
  }
}

function parseClaudeKeychainOutput(raw: string): ClaudeOauthTokens | null {
  if (!raw) {
    return null;
  }

  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    return parseClaudeOauthShape(json);
  } catch {
    const maybeToken = raw.trim();
    if (!maybeToken) {
      return null;
    }
    return {
      accessToken: maybeToken,
      refreshToken: null,
      expiresAt: 0,
    };
  }
}

function hasClaudeAccountState(): boolean {
  const state = readJsonFile(CLAUDE_STATE_PATH);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return false;
  }
  const obj = state as Record<string, unknown>;
  return !!(obj.oauthAccount && typeof obj.oauthAccount === 'object' && !Array.isArray(obj.oauthAccount));
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
