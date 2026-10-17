import { logger } from '@librechat/data-schemas';
import type { ILimitRequest, LimitWindow } from '@librechat/data-schemas';
import type { RequestLimitIncreaseRequest, UsagePendingRequest } from 'librechat-data-provider';
import type { Response } from 'express';
import type { CorporatePolicyMethods } from '~/corporate';
import type { ServerRequest } from '~/types/http';
import { resolvePolicy, toResolvePolicyDeps } from '~/corporate';
import { requestUserId } from './context';
import { toAdminLimitRequest } from './limitRequests';
import { startOfMonth, startOfToday } from './windows';

export interface CorporateUsageDeps extends CorporatePolicyMethods {
  getUsageTotals: (userId: string, since: Date) => Promise<{ costUsd: number; requests: number }>;
  getPendingLimitRequests: (userId: string) => Promise<ILimitRequest[]>;
  createLimitRequest: (
    userId: string,
    window: LimitWindow,
    comment?: string,
    limitBefore?: number | null,
  ) => Promise<ILimitRequest>;
}

function toPendingRequest(request: ILimitRequest): UsagePendingRequest {
  return {
    id: request._id.toString(),
    window: request.window,
    createdAt: request.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

const LIMIT_WINDOWS: LimitWindow[] = ['daily'];

function isLimitWindow(value: unknown): value is LimitWindow {
  return typeof value === 'string' && (LIMIT_WINDOWS as string[]).includes(value);
}

export function createCorporateUsageHandlers(deps: CorporateUsageDeps): {
  getMyUsage: (req: ServerRequest, res: Response) => Promise<Response>;
  requestLimitIncrease: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function getMyUsageHandler(req: ServerRequest, res: Response) {
    try {
      const userId = requestUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      /**
       * Месячная сумма остаётся в ответе — это отчёт о фактическом расходе (тот же смысл,
       * что и `spendMonth` в списке сотрудников админки), а не проверка порога: месячного
       * лимита в системе больше нет, поэтому у `monthly`, в отличие от `daily`, нет поля
       * `limits`.
       */
      const [dailyTotals, monthlyTotals, policy, pendingRequests] = await Promise.all([
        deps.getUsageTotals(userId, startOfToday()),
        deps.getUsageTotals(userId, startOfMonth()),
        resolvePolicy(toResolvePolicyDeps(deps), userId),
        deps.getPendingLimitRequests(userId),
      ]);

      return res.status(200).json({
        daily: {
          costUsd: dailyTotals.costUsd,
          requests: dailyTotals.requests,
          limits: { costUsd: policy.limits.dailyCostUsd },
        },
        monthly: {
          costUsd: monthlyTotals.costUsd,
          requests: monthlyTotals.requests,
        },
        pendingRequests: pendingRequests.map(toPendingRequest),
      });
    } catch (error) {
      logger.error('[corporateUsage] getMyUsage error:', error);
      return res.status(500).json({ error: 'Failed to load usage' });
    }
  }

  async function requestLimitIncreaseHandler(req: ServerRequest, res: Response) {
    try {
      const userId = requestUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { window, comment } = req.body as RequestLimitIncreaseRequest;
      if (!isLimitWindow(window)) {
        return res.status(400).json({ error: 'window must be "daily"' });
      }

      /** Snapshot the limit the user is actually hitting right now: once an admin raises
       *  it, the old value is gone from the policy, and the review screen has no other way
       *  to show what changed. */
      const policy = await resolvePolicy(toResolvePolicyDeps(deps), userId);
      const limitBefore = policy.limits.dailyCostUsd ?? null;

      const created = await deps.createLimitRequest(userId, window, comment, limitBefore);
      const userInfo = { name: req.user?.name ?? '', email: req.user?.email ?? '' };
      return res.status(201).json({ request: toAdminLimitRequest(created, userInfo) });
    } catch (error) {
      logger.error('[corporateUsage] requestLimitIncrease error:', error);
      return res.status(500).json({ error: 'Failed to create limit request' });
    }
  }

  return {
    getMyUsage: getMyUsageHandler,
    requestLimitIncrease: requestLimitIncreaseHandler,
  };
}
