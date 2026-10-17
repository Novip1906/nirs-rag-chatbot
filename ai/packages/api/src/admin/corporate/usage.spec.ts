import { Types } from 'mongoose';
import type { ILimitRequest } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateUsageDeps } from './usage';
import { createCorporateUsageHandlers } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NO_LIMITS = {
  dailyCostUsd: null,
};

function mockLimitRequest(overrides: Partial<ILimitRequest> = {}): ILimitRequest {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    window: 'daily',
    status: 'pending',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date('2026-08-01'),
    ...overrides,
  } as ILimitRequest;
}

function createReqRes(overrides: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  user?: Record<string, unknown> | null;
}) {
  const req = {
    params: {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user:
      overrides.user === undefined ? { _id: new Types.ObjectId(), role: 'USER' } : overrides.user,
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateUsageDeps> = {}): CorporateUsageDeps {
  return {
    getGlobalSettings: jest.fn().mockResolvedValue({
      systemPrompt: '',
      allowedModels: [],
      defaultLimits: { ...NO_LIMITS, dailyCostUsd: 200 },
    }),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    getDepartmentById: jest.fn().mockResolvedValue(null),
    getUsageTotals: jest.fn().mockResolvedValue({ costUsd: 5, requests: 1 }),
    getPendingLimitRequests: jest.fn().mockResolvedValue([]),
    createLimitRequest: jest.fn().mockResolvedValue(mockLimitRequest()),
    ...overrides,
  };
}

describe('createCorporateUsageHandlers', () => {
  describe('getMyUsage', () => {
    it('uses the authenticated caller id, ignoring any userId supplied in the query', async () => {
      const callerId = new Types.ObjectId();
      const deps = createDeps();
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({
        user: { _id: callerId, role: 'USER' },
        query: { userId: new Types.ObjectId().toString() },
      });

      await handlers.getMyUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const calledIds = (deps.getUsageTotals as jest.Mock).mock.calls.map((call) => call[0]);
      expect(calledIds).toEqual([callerId.toString(), callerId.toString()]);
      const response = json.mock.calls[0][0];
      expect(response.daily.limits).toEqual({ costUsd: 200 });
      expect(response.pendingRequests).toEqual([]);
    });

    /**
     * Месячная сумма — отчёт о фактическом расходе (как `spendMonth` в списке
     * сотрудников), не проверка порога: месячного лимита больше нет, поэтому у
     * `monthly`, в отличие от `daily`, нет поля `limits`.
     */
    it('reports the actual monthly spend without a monthly limit — there is none to check', async () => {
      const callerId = new Types.ObjectId();
      const getUsageTotals = jest
        .fn()
        .mockResolvedValueOnce({ costUsd: 5, requests: 1 })
        .mockResolvedValueOnce({ costUsd: 120, requests: 40 });
      const deps = createDeps({ getUsageTotals });
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, json } = createReqRes({ user: { _id: callerId, role: 'USER' } });

      await handlers.getMyUsage(req, res);

      const response = json.mock.calls[0][0];
      expect(response.monthly).toEqual({ costUsd: 120, requests: 40 });
      expect(response.monthly).not.toHaveProperty('limits');
    });

    it('fetches the daily total since midnight and the monthly total since the start of the month', async () => {
      const callerId = new Types.ObjectId();
      const calls: Date[] = [];
      const deps = createDeps({
        getUsageTotals: jest.fn().mockImplementation(async (_userId, since: Date) => {
          calls.push(since);
          return { costUsd: 0, requests: 0 };
        }),
      });
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res } = createReqRes({ user: { _id: callerId, role: 'USER' } });

      await handlers.getMyUsage(req, res);

      const now = new Date();
      expect(calls).toHaveLength(2);
      expect(calls[0].getDate()).toBe(now.getDate());
      expect(calls[1].getDate()).toBe(1);
      expect(calls[1].getMonth()).toBe(now.getMonth());
    });

    it('surfaces an open limit increase request as pendingRequests instead of leaving it to client-side storage', async () => {
      const callerId = new Types.ObjectId();
      const pending = mockLimitRequest({ window: 'daily' });
      const deps = createDeps({
        getPendingLimitRequests: jest.fn().mockResolvedValue([pending]),
      });
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, json } = createReqRes({ user: { _id: callerId, role: 'USER' } });

      await handlers.getMyUsage(req, res);

      const response = json.mock.calls[0][0];
      expect(response.pendingRequests).toEqual([
        {
          id: pending._id.toString(),
          window: 'daily',
          createdAt: pending.createdAt?.toISOString(),
        },
      ]);
    });

    it('returns 401 when there is no authenticated user', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, status } = createReqRes({ user: null });

      await handlers.getMyUsage(req, res);

      expect(status).toHaveBeenCalledWith(401);
      expect(deps.getUsageTotals).not.toHaveBeenCalled();
    });
  });

  describe('requestLimitIncrease', () => {
    it('rejects an invalid window value', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, status } = createReqRes({ body: { window: 'yearly' } });

      await handlers.requestLimitIncrease(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.createLimitRequest).not.toHaveBeenCalled();
    });

    it('rejects the removed monthly window — only "daily" is valid now', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, status } = createReqRes({ body: { window: 'monthly' } });

      await handlers.requestLimitIncrease(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.createLimitRequest).not.toHaveBeenCalled();
    });

    it('creates the request for the authenticated caller, ignoring a userId in the body', async () => {
      const callerId = new Types.ObjectId();
      const deps = createDeps({
        getGlobalSettings: jest.fn().mockResolvedValue({
          systemPrompt: '',
          allowedModels: [],
          defaultLimits: NO_LIMITS,
        }),
      });
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        user: { _id: callerId, role: 'USER' },
        body: { window: 'daily', comment: 'need more', userId: new Types.ObjectId().toString() },
      });

      await handlers.requestLimitIncrease(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(deps.createLimitRequest).toHaveBeenCalledWith(
        callerId.toString(),
        'daily',
        'need more',
        null,
      );
    });

    it('snapshots the effective daily limit at the moment of the request', async () => {
      const callerId = new Types.ObjectId();
      const deps = createDeps();
      const handlers = createCorporateUsageHandlers(deps);
      const { req, res } = createReqRes({
        user: { _id: callerId, role: 'USER' },
        body: { window: 'daily' },
      });

      await handlers.requestLimitIncrease(req, res);

      expect(deps.createLimitRequest).toHaveBeenCalledWith(
        callerId.toString(),
        'daily',
        undefined,
        200,
      );
    });
  });
});
