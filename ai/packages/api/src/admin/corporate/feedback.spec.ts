import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateFeedbackDeps } from './feedback';
import { createCorporateFeedbackHandlers } from './feedback';

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

function createDeps(overrides: Partial<CorporateFeedbackDeps> = {}): CorporateFeedbackDeps {
  return {
    listFeedback: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    ...overrides,
  };
}

describe('createCorporateFeedbackHandlers', () => {
  it('defaults to a 30 day window, limit 25, and skip 0', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    const spanDays = (query.to.getTime() - query.from.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeCloseTo(30, 0);
    expect(query.limit).toBe(25);
    expect(query.skip).toBe(0);
    expect(query.rating).toBeUndefined();
  });

  it('rejects a range where "from" is after "to"', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({
      from: '2026-08-20T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.listFeedback).not.toHaveBeenCalled();
  });

  it('accepts a valid rating and forwards it', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ rating: 'thumbsUp' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.rating).toBe('thumbsUp');
  });

  it('rejects an invalid rating', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ rating: 'nonsense' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.listFeedback).not.toHaveBeenCalled();
  });

  it('caps limit at 100 but accepts a value up to it', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ limit: '100' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.limit).toBe(100);
  });

  it('caps an oversized limit at the maximum page size', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ limit: '101' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.limit).toBe(100);
  });

  it('falls back to the default limit for a non-numeric value', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ limit: 'abc' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.limit).toBe(25);
  });

  it('clamps a negative skip to zero', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ skip: '-1' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.skip).toBe(0);
  });

  it('accepts a valid skip and forwards it', async () => {
    const deps = createDeps();
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status } = createReqRes({ skip: '10' });

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const query = (deps.listFeedback as jest.Mock).mock.calls[0][0];
    expect(query.skip).toBe(10);
  });

  it('serializes rows with an ISO date string and forwards total', async () => {
    const deps = createDeps({
      listFeedback: jest.fn().mockResolvedValue({
        rows: [
          {
            messageId: 'msg1',
            conversationId: 'conv1',
            userId: 'user1',
            userName: 'Alice',
            model: 'gpt-4',
            rating: 'thumbsDown',
            tag: 'incorrect',
            text: 'wrong answer',
            date: new Date('2026-08-10T12:00:00.000Z'),
          },
        ],
        total: 12,
      }),
    });
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, json } = createReqRes();

    await handlers.listFeedback(req, res);

    expect(json).toHaveBeenCalledWith({
      rows: [
        {
          messageId: 'msg1',
          conversationId: 'conv1',
          userId: 'user1',
          userName: 'Alice',
          model: 'gpt-4',
          rating: 'thumbsDown',
          tag: 'incorrect',
          text: 'wrong answer',
          date: '2026-08-10T12:00:00.000Z',
        },
      ],
      total: 12,
    });
  });

  it('returns 500 and logs when the dependency throws', async () => {
    const { logger } = jest.requireMock('@librechat/data-schemas') as {
      logger: { error: jest.Mock };
    };
    const deps = createDeps({
      listFeedback: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const handlers = createCorporateFeedbackHandlers(deps);
    const { req, res, status, json } = createReqRes();

    await handlers.listFeedback(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Failed to load feedback' });
    expect(logger.error).toHaveBeenCalled();
  });

  describe('department scope', () => {
    /**
     * `listFeedback` пагинирует на уровне базы, а data-schemas не умеет фильтровать
     * по отделу — постфактум фильтрация в обработчике сломала бы страницу и `total`,
     * поэтому, как и у `getActivity`, маршрут закрыт для главы целиком.
     */
    it('rejects a department head outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateFeedbackHandlers(deps);
      const { req, res, status } = createReqRes({}, { role: 'HEAD' });

      await handlers.listFeedback(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.listFeedback).not.toHaveBeenCalled();
    });

    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateFeedbackHandlers(deps);
      const { req, res, status } = createReqRes({}, { role: 'USER' });

      await handlers.listFeedback(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.listFeedback).not.toHaveBeenCalled();
    });
  });
});
