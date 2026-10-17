import { Types } from 'mongoose';
import type { ILimitRequest, IUserPolicy, LimitRequestStatus } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateLimitRequestsDeps } from './limitRequests';
import { createCorporateLimitRequestsHandlers } from './limitRequests';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function mockRequest(overrides: Partial<ILimitRequest> = {}): ILimitRequest {
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
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  caller?: { id?: Types.ObjectId | string; role?: string };
}) {
  const adminId = overrides.caller?.id ?? new Types.ObjectId();
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user: { _id: adminId, role: overrides.caller?.role ?? 'ADMIN' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json, adminId };
}

function createDeps(overrides: Partial<CorporateLimitRequestsDeps> = {}): CorporateLimitRequestsDeps {
  // `getLimitRequestById` заменил полную выгрузку внутри `findRequestInScope` (задача про
  // N+1): по умолчанию он ищет по тому же списку, что настраивает `listLimitRequests`, —
  // так существующие тесты, настраивающие только `listLimitRequests`, продолжают работать
  // без правки каждого места по отдельности; тест на сам `getLimitRequestById` — ниже.
  const listLimitRequests = overrides.listLimitRequests ?? jest.fn().mockResolvedValue([]);
  return {
    listLimitRequests,
    listLimitRequestsByUsers: jest.fn().mockResolvedValue([]),
    resolveLimitRequest: jest.fn().mockResolvedValue(mockRequest()),
    upsertUserPolicy: jest.fn().mockResolvedValue({}),
    findUsers: jest.fn().mockResolvedValue([]),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    listUserPolicies: jest.fn().mockResolvedValue(new Map()),
    getDepartmentById: jest.fn().mockResolvedValue(null),
    getGlobalSettings: jest.fn().mockResolvedValue({
      defaultLimits: { dailyCostUsd: null },
    }),
    getLimitRequestById: jest
      .fn()
      .mockImplementation(async (id: string, status?: LimitRequestStatus) => {
        const requests = await listLimitRequests(status);
        return requests.find((request: ILimitRequest) => request._id.toString() === id) ?? null;
      }),
    ...overrides,
  };
}

describe('createCorporateLimitRequestsHandlers', () => {
  it('defaults to listing only pending requests', async () => {
    const deps = createDeps();
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res } = createReqRes({});

    await handlers.listLimitRequests(req, res);

    expect(deps.listLimitRequests).toHaveBeenCalledWith('pending');
  });

  it('honors an explicit status filter', async () => {
    const deps = createDeps();
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res } = createReqRes({ query: { status: 'approved' } });

    await handlers.listLimitRequests(req, res);

    expect(deps.listLimitRequests).toHaveBeenCalledWith('approved');
  });

  it('approveLimitRequest looks the request up by id directly, without scanning the full queue', async () => {
    const target = mockRequest({ status: 'pending' });
    const deps = createDeps({ getLimitRequestById: jest.fn().mockResolvedValue(target) });
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res } = createReqRes({
      params: { id: target._id.toString() },
      body: { limits: { dailyCostUsd: 10 } },
    });

    await handlers.approveLimitRequest(req, res);

    expect(deps.getLimitRequestById).toHaveBeenCalledWith(target._id.toString(), 'pending');
    expect(deps.listLimitRequests).not.toHaveBeenCalled();
  });

  it('rejectLimitRequest for a department head looks the request up by id directly, without scanning the full history', async () => {
    const departmentId = new Types.ObjectId();
    const target = mockRequest();
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      getLimitRequestById: jest.fn().mockResolvedValue(target),
      listUserPolicies: jest
        .fn()
        .mockResolvedValue(new Map([[target.userId.toString(), { departmentId } as IUserPolicy]])),
      resolveLimitRequest: jest.fn().mockResolvedValue({ ...target, status: 'rejected' }),
    });
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res } = createReqRes({
      params: { id: target._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.rejectLimitRequest(req, res);

    expect(deps.getLimitRequestById).toHaveBeenCalledWith(target._id.toString(), undefined);
    expect(deps.listLimitRequests).not.toHaveBeenCalled();
  });

  describe('limit history', () => {
    it("attaches the requester's earlier requests, newest first, without the row itself", async () => {
      const userId = new Types.ObjectId();
      const current = mockRequest({ userId, limitBefore: 500 });
      const older = mockRequest({
        userId,
        status: 'approved',
        limitBefore: 200,
        limitAfter: 500,
        createdAt: new Date('2026-07-01'),
        resolvedAt: new Date('2026-07-02'),
      });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([current]),
        listLimitRequestsByUsers: jest.fn().mockResolvedValue([current, older]),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listLimitRequests(req, res);

      expect(deps.listLimitRequestsByUsers).toHaveBeenCalledWith([userId.toString()]);
      const [row] = json.mock.calls[0][0].requests;
      expect(row.limitBefore).toBe(500);
      expect(row.history).toEqual([
        expect.objectContaining({ id: older._id.toString(), limitBefore: 200, limitAfter: 500 }),
      ]);
    });

    it("keeps one user's history off another user's row", async () => {
      const mine = new Types.ObjectId();
      const theirs = new Types.ObjectId();
      const current = mockRequest({ userId: mine });
      const foreign = mockRequest({ userId: theirs, status: 'approved', limitAfter: 900 });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([current]),
        listLimitRequestsByUsers: jest.fn().mockResolvedValue([current, foreign]),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listLimitRequests(req, res);

      expect(json.mock.calls[0][0].requests[0].history).toEqual([]);
    });

    it('falls back to nulls for requests raised before snapshots existed', async () => {
      const current = mockRequest();
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([current]),
        listLimitRequestsByUsers: jest.fn().mockResolvedValue([current]),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listLimitRequests(req, res);

      const [row] = json.mock.calls[0][0].requests;
      expect(row.limitBefore).toBeNull();
      expect(row.limitAfter).toBeNull();
    });
  });

  describe('approveLimitRequest', () => {
    it('raises the personal limit for the requesting user, not the admin', async () => {
      const targetUserId = new Types.ObjectId();
      const target = mockRequest({ userId: targetUserId });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        resolveLimitRequest: jest.fn().mockResolvedValue({ ...target, status: 'approved' }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status, adminId } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 1000 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.resolveLimitRequest).toHaveBeenCalledWith(
        target._id.toString(),
        'approved',
        adminId.toString(),
        1000,
      );
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(targetUserId.toString(), {
        limits: { dailyCostUsd: 1000 },
      });
    });

    it('raises the limit before marking the request approved, not after', async () => {
      const target = mockRequest();
      const callOrder: string[] = [];
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        upsertUserPolicy: jest.fn().mockImplementation(async () => {
          callOrder.push('upsertUserPolicy');
          return {};
        }),
        resolveLimitRequest: jest.fn().mockImplementation(async () => {
          callOrder.push('resolveLimitRequest');
          return { ...target, status: 'approved' };
        }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(callOrder).toEqual(['upsertUserPolicy', 'resolveLimitRequest']);
    });

    it('does not lose the raised limit if marking the request approved fails afterward', async () => {
      const target = mockRequest();
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        resolveLimitRequest: jest.fn().mockResolvedValue(null),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(target.userId.toString(), {
        limits: { dailyCostUsd: 500 },
      });
      expect(status).toHaveBeenCalledWith(500);
    });

    it('returns 404 when the target request is not in the pending queue', async () => {
      const deps = createDeps({ listLimitRequests: jest.fn().mockResolvedValue([]) });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: new Types.ObjectId().toString() },
        body: { limits: { dailyCostUsd: 500 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejects approval without a limits payload', async () => {
      const deps = createDeps();
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: new Types.ObjectId().toString() },
        body: {},
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listLimitRequests).not.toHaveBeenCalled();
      expect(deps.resolveLimitRequest).not.toHaveBeenCalled();
    });

    it('rejects a negative limit instead of writing it to the policy', async () => {
      const target = mockRequest();
      const deps = createDeps({ listLimitRequests: jest.fn().mockResolvedValue([target]) });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: -5 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejects the removed request-count field instead of silently accepting it', async () => {
      const target = mockRequest();
      const deps = createDeps({ listLimitRequests: jest.fn().mockResolvedValue([target]) });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyRequests: 5 } },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });
  });

  it('reject does not touch the user policy', async () => {
    const deps = createDeps();
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: new Types.ObjectId().toString() } });

    await handlers.rejectLimitRequest(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('returns 404 when resolving a request that does not exist', async () => {
    const deps = createDeps({ resolveLimitRequest: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: new Types.ObjectId().toString() } });

    await handlers.rejectLimitRequest(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('joins requester name/email in a single bulk lookup, not one query per row', async () => {
    const requests = [mockRequest(), mockRequest(), mockRequest()];
    const deps = createDeps({
      listLimitRequests: jest.fn().mockResolvedValue(requests),
      findUsers: jest.fn().mockResolvedValue(
        requests.map((request) => ({
          _id: request.userId,
          name: 'Ivanov',
          email: 'ivanov@example.com',
        })),
      ),
    });
    const handlers = createCorporateLimitRequestsHandlers(deps);
    const { req, res, json } = createReqRes({});

    await handlers.listLimitRequests(req, res);

    expect(deps.findUsers).toHaveBeenCalledTimes(1);
    const response = json.mock.calls[0][0];
    expect(response.requests).toHaveLength(3);
    for (const row of response.requests) {
      expect(row.userName).toBe('Ivanov');
      expect(row.userEmail).toBe('ivanov@example.com');
    }
  });

  describe('department scope', () => {
    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({ caller: { role: 'USER' } });

      await handlers.listLimitRequests(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.listLimitRequests).not.toHaveBeenCalled();
    });

    it('rejects a department head with no department of their own', async () => {
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({ caller: { role: 'HEAD' } });

      await handlers.listLimitRequests(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.listLimitRequests).not.toHaveBeenCalled();
    });

    it("listLimitRequests narrows the page to the head's own department", async () => {
      const departmentId = new Types.ObjectId();
      const otherDepartmentId = new Types.ObjectId();
      const mine = mockRequest({ userId: new Types.ObjectId() });
      const theirs = mockRequest({ userId: new Types.ObjectId() });
      const policies = new Map([
        [mine.userId.toString(), { departmentId } as IUserPolicy],
        [theirs.userId.toString(), { departmentId: otherDepartmentId } as IUserPolicy],
      ]);
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([mine, theirs]),
        listUserPolicies: jest.fn().mockResolvedValue(policies),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, json } = createReqRes({ caller: { role: 'HEAD' } });

      await handlers.listLimitRequests(req, res);

      const response = json.mock.calls[0][0];
      expect(response.requests).toHaveLength(1);
      expect(response.requests[0].userId).toBe(mine.userId.toString());
    });

    it('approveLimitRequest refuses a request from another department', async () => {
      const departmentId = new Types.ObjectId();
      const otherDepartmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId() });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [target.userId.toString(), { departmentId: otherDepartmentId } as IUserPolicy],
            ]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('approveLimitRequest refuses a limit above the department default', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId(), window: 'daily' });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        getDepartmentById: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: 100 },
        }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Requested limit exceeds the department limit' });
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('approveLimitRequest allows a head to grant within the department default', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId(), window: 'daily' });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        getDepartmentById: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: 1000 },
        }),
        resolveLimitRequest: jest.fn().mockResolvedValue({ ...target, status: 'approved' }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(target.userId.toString(), {
        limits: { dailyCostUsd: 500 },
      });
    });

    it('approveLimitRequest falls back to the global default when the department has no limit set (the schema default)', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId(), window: 'daily' });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        // Отдел, которому админ ни разу не проставлял лимиты вручную — ровно
        // значение по умолчанию из схемы (`limitsDefaults`), а не выдуманное `null`.
        getDepartmentById: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: null },
        }),
        getGlobalSettings: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: 50 },
        }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: 500 } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Requested limit exceeds the department limit' });
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('approveLimitRequest treats a requested null (unlimited) as exceeding an existing ceiling', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId(), window: 'daily' });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        getDepartmentById: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: 100 },
        }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyCostUsd: null } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({ error: 'Requested limit exceeds the department limit' });
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('approveLimitRequest rejects the removed request-count field instead of silently accepting it', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId(), window: 'daily' });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        getDepartmentById: jest.fn().mockResolvedValue({
          defaultLimits: { dailyCostUsd: null },
        }),
        resolveLimitRequest: jest.fn().mockResolvedValue({ ...target, status: 'approved' }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        body: { limits: { dailyRequests: 1000 } },
        caller: { role: 'HEAD' },
      });

      await handlers.approveLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejectLimitRequest refuses a request from another department', async () => {
      const departmentId = new Types.ObjectId();
      const otherDepartmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId() });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [target.userId.toString(), { departmentId: otherDepartmentId } as IUserPolicy],
            ]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        caller: { role: 'HEAD' },
      });

      await handlers.rejectLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.resolveLimitRequest).not.toHaveBeenCalled();
    });

    it('rejectLimitRequest allows a head to reject a request from their own department', async () => {
      const departmentId = new Types.ObjectId();
      const target = mockRequest({ userId: new Types.ObjectId() });
      const deps = createDeps({
        listLimitRequests: jest.fn().mockResolvedValue([target]),
        listUserPolicies: jest
          .fn()
          .mockResolvedValue(
            new Map([[target.userId.toString(), { departmentId } as IUserPolicy]]),
          ),
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
        resolveLimitRequest: jest.fn().mockResolvedValue({ ...target, status: 'rejected' }),
      });
      const handlers = createCorporateLimitRequestsHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: target._id.toString() },
        caller: { role: 'HEAD' },
      });

      await handlers.rejectLimitRequest(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.resolveLimitRequest).toHaveBeenCalled();
    });
  });
});
