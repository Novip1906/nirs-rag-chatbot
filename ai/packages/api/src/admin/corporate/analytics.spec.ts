import { Types } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateAnalyticsDeps } from './analytics';
import { createCorporateAnalyticsHandlers } from './analytics';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(
  query: Record<string, string> = {},
  caller: { id?: string; role?: string } = {},
) {
  const req = {
    params: {},
    query,
    body: {},
    user: {
      _id: caller.id ?? new Types.ObjectId().toString(),
      role: caller.role ?? 'ADMIN',
    },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateAnalyticsDeps> = {}): CorporateAnalyticsDeps {
  return {
    getSpendSummary: jest.fn().mockResolvedValue([]),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('createCorporateAnalyticsHandlers', () => {
  it('rejects a missing groupBy', async () => {
    const deps = createDeps();
    const handlers = createCorporateAnalyticsHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.getAnalytics(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.getSpendSummary).not.toHaveBeenCalled();
  });

  it('rejects an invalid groupBy value', async () => {
    const deps = createDeps();
    const handlers = createCorporateAnalyticsHandlers(deps);
    const { req, res, status } = createReqRes({ groupBy: 'nonsense' });

    await handlers.getAnalytics(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.getSpendSummary).not.toHaveBeenCalled();
  });

  it('accepts each valid groupBy and forwards it to the summary query', async () => {
    for (const groupBy of ['user', 'department', 'model', 'day', 'scenario']) {
      const deps = createDeps();
      const handlers = createCorporateAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ groupBy });

      await handlers.getAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.getSpendSummary).toHaveBeenCalledWith(expect.objectContaining({ groupBy }));
    }
  });

  it('rejects a range where "from" is after "to"', async () => {
    const deps = createDeps();
    const handlers = createCorporateAnalyticsHandlers(deps);
    const { req, res, status } = createReqRes({
      groupBy: 'day',
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    await handlers.getAnalytics(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.getSpendSummary).not.toHaveBeenCalled();
  });

  describe('department scope', () => {
    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ groupBy: 'day' }, { role: 'USER' });

      await handlers.getAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getSpendSummary).not.toHaveBeenCalled();
    });

    it('rejects a department head with no department of their own', async () => {
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }),
      });
      const handlers = createCorporateAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ groupBy: 'day' }, { role: 'HEAD' });

      await handlers.getAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getSpendSummary).not.toHaveBeenCalled();
    });

    it("scopes the summary to the head's own department", async () => {
      const departmentId = new Types.ObjectId().toString();
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ groupBy: 'model' }, { role: 'HEAD' });

      await handlers.getAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.getSpendSummary).toHaveBeenCalledWith(expect.objectContaining({ departmentId }));
    });

    it('does not scope the summary for an admin', async () => {
      const deps = createDeps();
      const handlers = createCorporateAnalyticsHandlers(deps);
      const { req, res, status } = createReqRes({ groupBy: 'model' }, { role: 'ADMIN' });

      await handlers.getAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const query = (deps.getSpendSummary as jest.Mock).mock.calls[0][0];
      expect(query.departmentId).toBeUndefined();
      expect(deps.getUserPolicy).not.toHaveBeenCalled();
    });
  });
});
