import type { RateLimitInfo } from './ipc-api';

interface TaskRateLimitLike {
  providerId?: 'claude-code' | 'codex';
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  overageStatus?: string;
  overageResetsAt?: number;
  fetchedAt?: number;
}

/** Map variant rate-limit type strings from the API to a canonical short form. */
const RATE_LIMIT_TYPE_ALIASES: Record<string, string> = {
  'five_hour': '5h',
  'five hour': '5h',
  'fivehour': '5h',
  '5_hour': '5h',
  '5 hour': '5h',
  '5h': '5h',
  'seven_day': '7d',
  'seven day': '7d',
  'sevenday': '7d',
  '7_day': '7d',
  '7 day': '7d',
  '7d': '7d',
  'daily': 'daily',
  'minute': 'minute',
  '1m': 'minute',
};

export function canonicalRateLimitType(raw: string): string {
  return RATE_LIMIT_TYPE_ALIASES[raw.toLowerCase().trim()] ?? raw;
}

export function normalizeTaskRateLimit(
  info: TaskRateLimitLike | undefined,
  activeAgentId: string | undefined,
): RateLimitInfo | null {
  if (!info) return null;
  const inferredProvider = info.providerId ?? resolveRateLimitProvider(activeAgentId);
  if (!inferredProvider) return null;
  return {
    providerId: inferredProvider,
    status: coerceRateLimitStatus(info.status, info.utilization),
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : 0,
    rateLimitType: canonicalRateLimitType(info.rateLimitType ?? 'unknown'),
    utilization: typeof info.utilization === 'number' ? info.utilization : 0,
    ...(typeof info.overageStatus === 'string' ? { overageStatus: info.overageStatus } : {}),
    ...(typeof info.overageResetsAt === 'number' ? { overageResetsAt: info.overageResetsAt } : {}),
    ...(typeof info.fetchedAt === 'number' ? { fetchedAt: info.fetchedAt } : {}),
  };
}

export function resolveRateLimitProvider(
  agentId: string | undefined,
): RateLimitInfo['providerId'] | null {
  return agentId === 'claude-code' || agentId === 'codex'
    ? agentId
    : null;
}

export function coerceRateLimitStatus(
  status: string | undefined,
  utilization: number | undefined,
): RateLimitInfo['status'] {
  if (status === 'allowed' || status === 'allowed_warning' || status === 'rejected') {
    return status;
  }
  const pct = typeof utilization === 'number' ? utilization : 0;
  if (pct >= 1) return 'rejected';
  if (pct >= 0.8) return 'allowed_warning';
  return 'allowed';
}

export function mergeRateLimits(
  cached: RateLimitInfo[],
  active: RateLimitInfo | null,
): RateLimitInfo[] {
  const deduped = new Map<string, RateLimitInfo>();
  for (const entry of cached) {
    deduped.set(`${entry.providerId}:${entry.rateLimitType}`, entry);
  }
  if (active) {
    deduped.set(`${active.providerId}:${active.rateLimitType}`, active);
  }
  return Array.from(deduped.values()).sort((left, right) => {
    if (left.providerId === right.providerId) {
      return left.rateLimitType.localeCompare(right.rateLimitType);
    }
    return left.providerId.localeCompare(right.providerId);
  });
}

export function computeHighestSeverity(
  entries: RateLimitInfo[],
): RateLimitInfo['status'] | null {
  if (entries.some((entry) => entry.status === 'rejected')) return 'rejected';
  if (entries.some((entry) => entry.status === 'allowed_warning')) return 'allowed_warning';
  if (entries.some((entry) => entry.status === 'allowed')) return 'allowed';
  return null;
}

export function providerLabel(providerId: RateLimitInfo['providerId']): string {
  return providerId === 'claude-code' ? 'Claude Code' : 'Codex';
}

export function rateLimitTextColor(entry: Pick<RateLimitInfo, 'status'>): string {
  if (entry.status === 'rejected') return 'text-error';
  if (entry.status === 'allowed_warning') return 'text-warning';
  if (entry.status === 'allowed') return 'text-success';
  return 'text-text-secondary';
}

export function formatTimeUntil(timestamp: number): string {
  const diffMs = Math.max(0, timestamp - Date.now());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
