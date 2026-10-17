import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { AdminActivityResponse, AdminFeedbackCounts } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { DateRange } from './dateRange';
import { resolveDateRange, DATE_RANGE_ERROR } from './dateRange';

export interface ActivitySummary {
  activeUsers: number;
  requests: number;
  returningUsers: number;
  totalActiveDays: number;
}

export interface CorporateActivityDeps {
  getActivitySummary: (query: DateRange) => Promise<ActivitySummary>;
  getFeedbackSummary: (query: DateRange) => Promise<AdminFeedbackCounts>;
}

function averagePerUser(total: number, activeUsers: number): number {
  if (activeUsers === 0) {
    return 0;
  }
  return Math.round((total / activeUsers) * 10) / 10;
}

export function createCorporateActivityHandlers(deps: CorporateActivityDeps): {
  getActivity: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function getActivityHandler(req: ServerRequest, res: Response) {
    try {
      /**
       * `getActivitySummary`/`getFeedbackSummary` aggregate company-wide, with no
       * department filter at the data layer — widening them is a `data-schemas` change
       * outside this handler's scope. Until that exists, a department head gets a flat
       * refusal here rather than a company-wide activity count dressed up as their own.
       */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const range = resolveDateRange(req.query);
      if (!range) {
        return res.status(400).json({ error: DATE_RANGE_ERROR });
      }

      const [activity, feedback] = await Promise.all([
        deps.getActivitySummary(range),
        deps.getFeedbackSummary(range),
      ]);

      const response: AdminActivityResponse = {
        activeUsers: activity.activeUsers,
        requests: activity.requests,
        avgRequestsPerUser: averagePerUser(activity.requests, activity.activeUsers),
        returningUsers: activity.returningUsers,
        avgActiveDaysPerUser: averagePerUser(activity.totalActiveDays, activity.activeUsers),
        feedback,
      };

      return res.status(200).json(response);
    } catch (error) {
      logger.error('[corporateActivity] getActivity error:', error);
      return res.status(500).json({ error: 'Failed to load activity' });
    }
  }

  return { getActivity: getActivityHandler };
}
