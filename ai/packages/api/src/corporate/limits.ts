import type { LimitWindow } from '@librechat/data-schemas';
import type { EffectivePolicy } from './policy';

export interface LimitVerdict {
  allowed: boolean;
  window?: LimitWindow;
  kind?: 'cost';
  used?: number;
  limit?: number;
  resetAt?: string;
}

export interface AssertLimitsDeps {
  getUsageTotals: (userId: string, since: Date) => Promise<{ costUsd: number; requests: number }>;
  resolvePolicy: (userId: string) => Promise<EffectivePolicy>;
}

export function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function nextDayStart(now: Date): Date {
  const start = startOfDay(now);
  start.setDate(start.getDate() + 1);
  return start;
}

/**
 * Порог считается только в деньгах: лимит по количеству запросов из системы убран.
 *
 * Reaching a threshold (not just exceeding it) blocks further use — a `limit` of N allows N.
 *
 * `!Number.isFinite(limit)` treats a `NaN`/`Infinity` threshold the same as `null` — no
 * enforceable value can't be enforced. Not reachable via the HTTP API (input is validated
 * there), only via a corrupted DB document, but relational comparisons against `NaN` are
 * always `false`, so without this guard `used < limit` would fall through to the deny
 * branch regardless of `used` and report `limit: NaN`, which serializes to `limit: null`
 * over JSON — indistinguishable from "not checked" while actually meaning "blocked".
 */
function checkThreshold(
  window: LimitWindow,
  used: number,
  limit: number | null,
  resetAt: Date,
): LimitVerdict | null {
  if (limit == null || !Number.isFinite(limit) || used < limit) {
    return null;
  }
  return { allowed: false, window, kind: 'cost', used, limit, resetAt: resetAt.toISOString() };
}

export async function assertWithinLimits(
  deps: AssertLimitsDeps,
  userId: string,
): Promise<LimitVerdict> {
  const policy = await deps.resolvePolicy(userId);
  if (policy.blocked) {
    return { allowed: false };
  }

  const now = new Date();
  const dailyTotals = await deps.getUsageTotals(userId, startOfDay(now));

  return (
    checkThreshold('daily', dailyTotals.costUsd, policy.limits.dailyCostUsd, nextDayStart(now)) ?? {
      allowed: true,
    }
  );
}
