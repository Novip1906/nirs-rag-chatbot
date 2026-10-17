import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateActivityDeps } from './activity';
import { createCorporateActivityHandlers } from './activity';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(query: Record<string, string> = {}, caller: { role?: string } = {}) {
  const req = {
    params: {},
    query,
    body: {},
    user: { _id: 'admin-1', role: caller.role ?? 'ADMIN' },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateActivityDeps> = {}): CorporateActivityDeps {
  return {
    getActivitySummary: jest
      .fn()
      .mockResolvedValue({ activeUsers: 0, requests: 0, returningUsers: 0, totalActiveDays: 0 }),
    getFeedbackSummary: jest.fn().mockResolvedValue({ thumbsUp: 0, thumbsDown: 0 }),
    ...overrides,
  };
}

describe('createCorporateActivityHandlers', () => {
  it('defaults to a 30 day window ending now when no range is given', async () => {
    const deps = createDeps();
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.getActivity(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.getActivitySummary as jest.Mock).mock.calls[0][0];
    const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeCloseTo(30, 0);
  });

  it('forwards an explicit range to both summary lookups', async () => {
    const deps = createDeps();
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, status } = createReqRes({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-20T00:00:00.000Z',
    });

    await handlers.getActivity(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const activityQuery = (deps.getActivitySummary as jest.Mock).mock.calls[0][0];
    const feedbackQuery = (deps.getFeedbackSummary as jest.Mock).mock.calls[0][0];
    expect(activityQuery).toEqual({
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(feedbackQuery).toEqual(activityQuery);
  });

  it('rejects a range where "from" is after "to"', async () => {
    const deps = createDeps();
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, status } = createReqRes({
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    await handlers.getActivity(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.getActivitySummary).not.toHaveBeenCalled();
  });

  it('calls both summary dependencies in parallel', async () => {
    const order: string[] = [];
    let resolveActivity: (() => void) | undefined;
    const deps = createDeps({
      getActivitySummary: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            order.push('activity-start');
            resolveActivity = () => {
              order.push('activity-end');
              resolve({ activeUsers: 1, requests: 1, returningUsers: 0, totalActiveDays: 1 });
            };
          }),
      ),
      getFeedbackSummary: jest.fn().mockImplementation(async () => {
        order.push('feedback');
        return { thumbsUp: 0, thumbsDown: 0 };
      }),
    });
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res } = createReqRes();

    const pending = handlers.getActivity(req, res);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['activity-start', 'feedback']);
    resolveActivity?.();
    await pending;
  });

  it('computes averages and rounds them to one decimal', async () => {
    const deps = createDeps({
      getActivitySummary: jest
        .fn()
        .mockResolvedValue({ activeUsers: 3, requests: 10, returningUsers: 2, totalActiveDays: 7 }),
      getFeedbackSummary: jest.fn().mockResolvedValue({ thumbsUp: 4, thumbsDown: 1 }),
    });
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, json } = createReqRes();

    await handlers.getActivity(req, res);

    expect(json).toHaveBeenCalledWith({
      activeUsers: 3,
      requests: 10,
      avgRequestsPerUser: 3.3,
      returningUsers: 2,
      avgActiveDaysPerUser: 2.3,
      feedback: { thumbsUp: 4, thumbsDown: 1 },
    });
  });

  it('returns zero averages instead of NaN when there are no active users', async () => {
    const deps = createDeps();
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, json } = createReqRes();

    await handlers.getActivity(req, res);

    const response = json.mock.calls[0][0];
    expect(response.avgRequestsPerUser).toBe(0);
    expect(response.avgActiveDaysPerUser).toBe(0);
    expect(Number.isNaN(response.avgRequestsPerUser)).toBe(false);
    expect(Number.isNaN(response.avgActiveDaysPerUser)).toBe(false);
  });

  it('returns 500 and logs when a dependency throws', async () => {
    const { logger } = jest.requireMock('@librechat/data-schemas') as {
      logger: { error: jest.Mock };
    };
    const deps = createDeps({
      getActivitySummary: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const handlers = createCorporateActivityHandlers(deps);
    const { req, res, status, json } = createReqRes();

    await handlers.getActivity(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Failed to load activity' });
    expect(logger.error).toHaveBeenCalled();
  });

  describe('department scope', () => {
    /**
     * `getActivitySummary`/`getFeedbackSummary` не умеют фильтровать по отделу (это
     * изменение в `data-schemas`, вне рамок этой задачи), поэтому глава получает
     * отказ целиком вместо общекорпоративной статистики, выданной за его собственную.
     */
    it('rejects a department head outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateActivityHandlers(deps);
      const { req, res, status } = createReqRes({}, { role: 'HEAD' });

      await handlers.getActivity(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getActivitySummary).not.toHaveBeenCalled();
    });

    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateActivityHandlers(deps);
      const { req, res, status } = createReqRes({}, { role: 'USER' });

      await handlers.getActivity(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getActivitySummary).not.toHaveBeenCalled();
    });
  });
});
