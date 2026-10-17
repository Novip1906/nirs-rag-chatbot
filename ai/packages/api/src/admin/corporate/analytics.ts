import { logger } from '@librechat/data-schemas';
import type { SpendGroupBy } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CallerDepartment } from './departmentScope';
import { resolveDateRange, DATE_RANGE_ERROR } from './dateRange';
import { resolveRequestDepartmentScope } from './departmentScope';
import { requestUserId } from './context';

const GROUP_BY_VALUES: SpendGroupBy[] = ['user', 'department', 'model', 'day', 'scenario'];

export interface AnalyticsQueryInput {
  from: Date;
  to: Date;
  groupBy: SpendGroupBy;
  departmentId?: string;
}

export interface SpendSummaryRow {
  key: string;
  label: string;
  costUsd: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  unknownCostRequests: number;
}

export interface CorporateAnalyticsDeps {
  getSpendSummary: (query: AnalyticsQueryInput) => Promise<SpendSummaryRow[]>;
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
}

function isSpendGroupBy(value: unknown): value is SpendGroupBy {
  return typeof value === 'string' && (GROUP_BY_VALUES as string[]).includes(value);
}

export function createCorporateAnalyticsHandlers(deps: CorporateAnalyticsDeps): {
  getAnalytics: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function getAnalyticsHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const groupBy = req.query.groupBy;
      if (!isSpendGroupBy(groupBy)) {
        return res
          .status(400)
          .json({ error: 'groupBy must be one of user, department, model, day, scenario' });
      }

      const range = resolveDateRange(req.query);
      if (!range) {
        return res.status(400).json({ error: DATE_RANGE_ERROR });
      }

      const rows = await deps.getSpendSummary({
        ...range,
        groupBy,
        ...(scope.departmentId != null ? { departmentId: scope.departmentId } : {}),
      });
      return res.status(200).json({ rows });
    } catch (error) {
      logger.error('[corporateAnalytics] getAnalytics error:', error);
      return res.status(500).json({ error: 'Failed to load analytics' });
    }
  }

  return { getAnalytics: getAnalyticsHandler };
}
