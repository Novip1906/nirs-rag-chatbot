import { Types } from 'mongoose';
import { SystemRoles } from 'librechat-data-provider';
import type {
  IDepartment,
  IKnowledgeSpace,
  IUser,
  IUserPolicy,
  SpendRow,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateUsersDeps } from './users';
import { createCorporateUsersHandlers, validateKnowledgeUploadFlag } from './users';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NO_LIMITS = {
  dailyCostUsd: null,
};

/**
 * `findUsers`/`findUser` return `.lean()` documents — plain objects with `_id`
 * only, no Mongoose `id` virtual. Mirroring that shape here (instead of also
 * setting `id`) is what makes these tests actually catch a handler reading
 * `user.id` instead of `user._id`.
 */
function mockUser(overrides: Partial<Omit<IUser, 'id'>> = {}): Omit<IUser, 'id'> {
  return {
    _id: new Types.ObjectId(),
    name: 'Alice',
    email: 'alice@example.com',
    role: 'USER',
    ...overrides,
  } as Omit<IUser, 'id'>;
}

function mockDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: new Types.ObjectId(),
    name: 'Sales',
    allowedModels: ['gpt-4'],
    defaultLimits: NO_LIMITS,
    ...overrides,
  } as IDepartment;
}

function mockSpendRow(userId: string, overrides: Partial<SpendRow> = {}): SpendRow {
  return {
    key: userId,
    label: userId,
    costUsd: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    unknownCostRequests: 0,
    ...overrides,
  };
}

function mockPolicy(overrides: Partial<IUserPolicy> = {}): IUserPolicy {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    departmentId: null,
    limits: null,
    allowedModels: null,
    blocked: false,
    ...overrides,
  } as IUserPolicy;
}

function mockSpace(overrides: Partial<IKnowledgeSpace> = {}): IKnowledgeSpace {
  return {
    _id: new Types.ObjectId(),
    name: 'Кадры',
    allowedDepartments: [],
    enabled: true,
    ...overrides,
  } as IKnowledgeSpace;
}

function createReqRes(overrides: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  caller?: { id?: string; role?: string; openidId?: string };
}) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user: {
      _id: overrides.caller?.id ?? new Types.ObjectId().toString(),
      role: overrides.caller?.role ?? SystemRoles.ADMIN,
      ...(overrides.caller?.openidId ? { openidId: overrides.caller.openidId } : {}),
    },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

/** Builds the page shape `listAdminUserPage` returns, policy included per row. */
function mockUserPage(
  rows: Array<{ user: Partial<IUser>; policy?: IUserPolicy | null }>,
  total = rows.length,
) {
  return {
    rows: rows.map(({ user, policy }) => ({ user: mockUser(user), policy: policy ?? null })),
    total,
  };
}

function createDeps(overrides: Partial<CorporateUsersDeps> = {}): CorporateUsersDeps {
  return {
    findUser: jest.fn().mockResolvedValue(null),
    updateUser: jest.fn().mockResolvedValue(null),
    listAdminUserPage: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    listDepartments: jest.fn().mockResolvedValue([]),
    getUserPolicy: jest.fn().mockResolvedValue(null),
    listUserPolicies: jest.fn().mockResolvedValue(new Map()),
    getGlobalSettings: jest.fn().mockResolvedValue({
      systemPrompt: 'global',
      allowedModels: ['gpt-4'],
      defaultModel: 'gpt-4',
      defaultLimits: NO_LIMITS,
    }),
    getDepartmentById: jest.fn().mockResolvedValue(null),
    getSpendSummary: jest.fn().mockResolvedValue([]),
    upsertUserPolicy: jest.fn().mockResolvedValue(mockPolicy()),
    listSpaces: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('createCorporateUsersHandlers', () => {
  describe('listUsers', () => {
    it("resolves each user's effective department, limits and spend totals", async () => {
      const department = mockDepartment({
        name: 'Sales',
        defaultLimits: { ...NO_LIMITS, dailyCostUsd: 500 },
      });
      const user = mockUser();
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue({
          rows: [
            {
              user,
              policy: mockPolicy({
                departmentId: department._id,
                limits: null,
                allowedModels: null,
                blocked: false,
              }),
            },
          ],
          total: 1,
        }),
        listDepartments: jest.fn().mockResolvedValue([department]),
        getSpendSummary: jest
          .fn()
          .mockResolvedValueOnce([mockSpendRow(user._id.toString(), { costUsd: 12, requests: 3 })])
          .mockResolvedValueOnce([
            mockSpendRow(user._id.toString(), { costUsd: 88, requests: 21 }),
          ]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({});

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const response = json.mock.calls[0][0];
      expect(response.total).toBe(1);
      expect(response.users).toHaveLength(1);
      const item = response.users[0];
      expect(item.id).toBe(user._id.toString());
      expect(item.departmentName).toBe('Sales');
      expect(item.limits.dailyCostUsd).toBe(500);
      expect(item.spendToday).toEqual({ costUsd: 12, requests: 3 });
      expect(item.spendMonth).toEqual({ costUsd: 88, requests: 21 });
    });

    it('exposes the stable employee id and position alongside the mongo id', async () => {
      const user = mockUser({
        employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        position: 'Analyst',
      });
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue({
          rows: [
            { user, policy: mockPolicy({ limits: null, allowedModels: null, blocked: false }) },
          ],
          total: 1,
        }),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      const item = json.mock.calls[0][0].users[0];
      expect(item.employeeId).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
      expect(item.position).toBe('Analyst');
    });

    it('exposes the single sign-on subject of the user', async () => {
      const user = mockUser({ openidId: 'sub-from-sso' });
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue({
          rows: [
            { user, policy: mockPolicy({ limits: null, allowedModels: null, blocked: false }) },
          ],
          total: 1,
        }),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      const item = json.mock.calls[0][0].users[0];
      expect(item.openidId).toBe('sub-from-sso');
    });

    it('reports a missing employee id as null instead of dropping the field', async () => {
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue({
          rows: [
            {
              user: mockUser(),
              policy: mockPolicy({ limits: null, allowedModels: null, blocked: false }),
            },
          ],
          total: 1,
        }),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      const item = json.mock.calls[0][0].users[0];
      expect(item.employeeId).toBeNull();
    });

    it('exposes the raw personal override next to the effective limits, instead of only the merged result', async () => {
      const department = mockDepartment({ defaultLimits: { ...NO_LIMITS, dailyCostUsd: 200 } });
      const user = mockUser();
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue({
          rows: [
            {
              user,
              policy: mockPolicy({
                departmentId: department._id,
                limits: { dailyCostUsd: 300 },
                allowedModels: null,
              }),
            },
          ],
          total: 1,
        }),
        listDepartments: jest.fn().mockResolvedValue([department]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      const item = json.mock.calls[0][0].users[0];
      expect(item.limits.dailyCostUsd).toBe(300);
      expect(item.limitsOverride).toEqual({ dailyCostUsd: 300 });
      expect(item.allowedModelsOverride).toBeNull();
    });

    /**
     * Политика приезжает внутри строки страницы, поэтому отдельного чтения политик у
     * списка больше нет вовсе — ни пакетного, ни тем более по одному на пользователя.
     */
    it('takes policies from the page itself instead of reading them again', async () => {
      const users = Array.from({ length: 20 }, () => mockUser());
      const deps = createDeps({
        listAdminUserPage: jest
          .fn()
          .mockResolvedValue(mockUserPage(users.map((user) => ({ user })))),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({});

      await handlers.listUsers(req, res);

      expect(deps.listUserPolicies).not.toHaveBeenCalled();
      expect(deps.getUserPolicy).not.toHaveBeenCalled();
    });

    it('defaults a user missing from the spend aggregation to zero instead of dropping them', async () => {
      const user = mockUser();
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue(mockUserPage([{ user }])),
        getSpendSummary: jest.fn().mockResolvedValue([]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      const item = json.mock.calls[0][0].users[0];
      expect(item.spendToday).toEqual({ costUsd: 0, requests: 0 });
      expect(item.spendMonth).toEqual({ costUsd: 0, requests: 0 });
    });

    it('fetches exactly one spend aggregation per window regardless of page size', async () => {
      const users = Array.from({ length: 20 }, () => mockUser());
      const deps = createDeps({
        listAdminUserPage: jest
          .fn()
          .mockResolvedValue(mockUserPage(users.map((user) => ({ user })))),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({});

      await handlers.listUsers(req, res);

      expect(deps.getSpendSummary).toHaveBeenCalledTimes(2);
    });

    it('forwards limit/offset query params to the page query and the response', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({ query: { limit: '10', offset: '20' } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
      const response = json.mock.calls[0][0];
      expect(response.limit).toBe(10);
      expect(response.offset).toBe(20);
    });

    it('takes the total from the page rather than counting users separately', async () => {
      const user = mockUser();
      const deps = createDeps({
        listAdminUserPage: jest.fn().mockResolvedValue(mockUserPage([{ user }], 137)),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({});

      await handlers.listUsers(req, res);

      expect(json.mock.calls[0][0].total).toBe(137);
    });

    it('forwards a trimmed search term', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { search: ' Ivan ' } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Ivan' }),
      );
    });

    it('treats a blank search term as no filter at all', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { search: '   ' } });

      await handlers.listUsers(req, res);

      const query = (deps.listAdminUserPage as jest.Mock).mock.calls[0][0];
      expect(query.search).toBeUndefined();
    });
  });

  describe('listUsers filters', () => {
    it('forwards a department id', async () => {
      const departmentId = new Types.ObjectId().toString();
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { departmentId } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId }),
      );
    });

    it('forwards the no-department sentinel untouched', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { departmentId: 'none' } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: 'none' }),
      );
    });

    it('rejects a malformed department id instead of querying with it', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { departmentId: 'not-an-id' } });

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid department ID format' });
      expect(deps.listAdminUserPage).not.toHaveBeenCalled();
    });

    it.each([
      ['active', false],
      ['blocked', true],
    ])('maps status=%s to blocked=%s', async (status, blocked) => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { status } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(expect.objectContaining({ blocked }));
    });

    it('rejects an unknown status', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { status: 'pending' } });

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid status filter' });
    });

    it('forwards a role filter as an exact value', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ query: { role: 'ADMIN' } });

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ADMIN' }),
      );
    });

    it('rejects a role filter carrying control characters', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { role: 'ADMIN\u0000' } });

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ error: 'Invalid role filter' });
      expect(deps.listAdminUserPage).not.toHaveBeenCalled();
    });

    it('rejects an over-long role filter', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({ query: { role: 'x'.repeat(65) } });

      await handlers.listUsers(req, res);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('omits absent filters from the page query entirely', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({});

      await handlers.listUsers(req, res);

      expect(deps.listAdminUserPage).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    });
  });

  describe('getUser', () => {
    it('rejects a malformed id', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: 'not-an-id' } });

      await handlers.getUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findUser).not.toHaveBeenCalled();
    });

    it('returns 404 when the user does not exist', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(null) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({ params: { id: validId } });

      await handlers.getUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });

    it('returns the user row with limits inherited from their department', async () => {
      const department = mockDepartment({
        name: 'Sales',
        allowedModels: ['gpt-4'],
        defaultLimits: { ...NO_LIMITS, dailyCostUsd: 500 },
      });
      const user = mockUser();
      const id = user._id.toString();
      const policy = mockPolicy({
        departmentId: department._id,
        limits: null,
        allowedModels: null,
      });
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(user),
        listDepartments: jest.fn().mockResolvedValue([department]),
        listUserPolicies: jest.fn().mockResolvedValue(new Map([[id, policy]])),
        getSpendSummary: jest
          .fn()
          .mockResolvedValueOnce([mockSpendRow(id, { costUsd: 5, requests: 1 })])
          .mockResolvedValueOnce([mockSpendRow(id, { costUsd: 50, requests: 10 })]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id } });

      await handlers.getUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const item = json.mock.calls[0][0].user;
      expect(item.id).toBe(id);
      expect(item.departmentName).toBe('Sales');
      expect(item.limits.dailyCostUsd).toBe(500);
      expect(item.allowedModels).toEqual(['gpt-4']);
      expect(item.spendToday).toEqual({ costUsd: 5, requests: 1 });
      expect(item.spendMonth).toEqual({ costUsd: 50, requests: 10 });
    });

    it('resolves user by employeeId', async () => {
      const user = mockUser({
        employeeId: '0b4f7c2e-8a3d-4f6e-9c1a-2d5e7f9a1b3c',
        position: 'Lead',
      });
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(user) });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: user.employeeId as string },
      });

      await handlers.getUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.findUser).toHaveBeenCalledWith(
        { employeeId: user.employeeId },
        expect.any(String),
      );
      const item = json.mock.calls[0][0].user;
      expect(item.id).toBe(user._id.toString());
      expect(item.employeeId).toBe(user.employeeId);
      expect(item.position).toBe('Lead');
    });
  });

  describe('updateUser', () => {
    it('rejects an invalid user id', async () => {
      const deps = createDeps();
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: 'not-an-id' } });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('returns 404 when the target user does not exist', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(null) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({ params: { id: validId } });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(404);
    });

    it.each([
      ['departmentId', { departmentId: null }],
      ['blocked', { blocked: true }],
    ])('rejects %s with FIELD_NOT_EDITABLE', async (_field, body) => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(mockUser()) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status, json } = createReqRes({ params: { id: validId }, body });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error_code: 'FIELD_NOT_EDITABLE' }),
      );
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejects departmentId and blocked with FIELD_NOT_EDITABLE for a department head too', async () => {
      const deps = createDeps({
        getUserPolicy: jest.fn().mockResolvedValue({ departmentId: new Types.ObjectId() }),
        findUser: jest.fn().mockResolvedValue(mockUser()),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: new Types.ObjectId().toString() },
        body: { departmentId: null, blocked: true },
        caller: { role: 'HEAD' },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error_code: 'FIELD_NOT_EDITABLE' }),
      );
    });

    it('resolves user by employeeId', async () => {
      const user = mockUser({ employeeId: '0b4f7c2e-8a3d-4f6e-9c1a-2d5e7f9a1b3c' });
      const id = user._id.toString();
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(user) });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: user.employeeId as string },
        body: { limits: null },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.findUser).toHaveBeenCalledWith(
        { employeeId: user.employeeId },
        expect.any(String),
      );
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(id, { limits: null });
    });

    it('rejects a negative limit instead of silently blocking the user on it', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(mockUser()) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: { limits: { dailyCostUsd: -5 } },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejects the removed request-count field', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(mockUser()) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: { limits: { dailyRequests: 2.5 } },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('still allows clearing the whole override with limits: null', async () => {
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: { limits: null },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(validId, { limits: null });
    });

    it('only forwards the fields present in the request body', async () => {
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: { canUploadKnowledge: false },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(validId, { canUploadKnowledge: false });
    });

    it('reuses the upsert result for the response instead of re-reading the policy', async () => {
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
        upsertUserPolicy: jest
          .fn()
          .mockResolvedValue(mockPolicy({ limits: { dailyCostUsd: 777 } })),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({
        params: { id: validId },
        body: { limits: { dailyCostUsd: 777 } },
      });

      await handlers.updateUser(req, res);

      expect(deps.getUserPolicy).not.toHaveBeenCalled();
      const user = json.mock.calls[0][0].user;
      expect(user.id).toBe(validId);
      expect(user.limits.dailyCostUsd).toBe(777);
      expect(user.limitsOverride).toEqual({ dailyCostUsd: 777 });
      expect(user.blocked).toBe(false);
    });

    it('scopes the spend aggregation to the target user instead of pulling everyone', async () => {
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res } = createReqRes({ params: { id: validId }, body: { limits: null } });

      await handlers.updateUser(req, res);

      const calls = (deps.getSpendSummary as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      for (const [query] of calls) {
        expect(query.userId).toBe(validId);
      }
    });

    it('does not call listSpaces when allowedSpaces/deniedSpaces are absent from the body', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(mockUser()) });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res } = createReqRes({ params: { id: validId }, body: { limits: null } });

      await handlers.updateUser(req, res);

      expect(deps.listSpaces).not.toHaveBeenCalled();
    });

    it('rejects an unknown space id in allowedSpaces instead of silently saving it', async () => {
      const knownSpace = mockSpace();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser()),
        listSpaces: jest.fn().mockResolvedValue([knownSpace]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: { allowedSpaces: ['ghost-space-id'] },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('rejects an unknown space id in deniedSpaces even when allowedSpaces is valid', async () => {
      const knownSpace = mockSpace();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser()),
        listSpaces: jest.fn().mockResolvedValue([knownSpace]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const validId = new Types.ObjectId().toString();
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: {
          allowedSpaces: [knownSpace._id.toString()],
          deniedSpaces: ['ghost-space-id'],
        },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    });

    it('forwards allowedSpaces/deniedSpaces to upsertUserPolicy once they reference real spaces', async () => {
      const spaceA = mockSpace();
      const spaceB = mockSpace();
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
        listSpaces: jest.fn().mockResolvedValue([spaceA, spaceB]),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validId },
        body: {
          allowedSpaces: [spaceA._id.toString()],
          deniedSpaces: [spaceB._id.toString()],
        },
      });

      await handlers.updateUser(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertUserPolicy).toHaveBeenCalledWith(validId, {
        allowedSpaces: [spaceA._id.toString()],
        deniedSpaces: [spaceB._id.toString()],
      });
    });

    it('returns the saved allowedSpaces/deniedSpaces as strings on the user row', async () => {
      const spaceA = mockSpace();
      const validId = new Types.ObjectId().toString();
      const deps = createDeps({
        findUser: jest.fn().mockResolvedValue(mockUser({ _id: new Types.ObjectId(validId) })),
        listSpaces: jest.fn().mockResolvedValue([spaceA]),
        upsertUserPolicy: jest
          .fn()
          .mockResolvedValue(mockPolicy({ allowedSpaces: [spaceA._id], deniedSpaces: [] })),
      });
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, json } = createReqRes({
        params: { id: validId },
        body: { allowedSpaces: [spaceA._id.toString()] },
      });

      await handlers.updateUser(req, res);

      const user = json.mock.calls[0][0].user;
      expect(user.allowedSpaces).toEqual([spaceA._id.toString()]);
      expect(user.deniedSpaces).toEqual([]);
    });
  });
});

describe('validateKnowledgeUploadFlag', () => {
  it('не даёт включить право сотруднику без отдела', () => {
    expect(
      validateKnowledgeUploadFlag({ canUploadKnowledge: true, nextDepartmentId: null }),
    ).toEqual({
      ok: false,
      error: 'Employee must belong to a department to upload knowledge documents',
    });
  });

  it('учитывает отдел, назначаемый тем же запросом', () => {
    expect(
      validateKnowledgeUploadFlag({
        canUploadKnowledge: true,
        nextDepartmentId: '65f0000000000000000000aa',
      }),
    ).toEqual({ ok: true });
  });

  it('снятие права разрешает всегда', () => {
    expect(
      validateKnowledgeUploadFlag({ canUploadKnowledge: false, nextDepartmentId: null }),
    ).toEqual({ ok: true });
  });
});

describe('createCorporateUsersHandlers updateUserAiRole', () => {
  const targetId = new Types.ObjectId().toString();
  const departmentId = new Types.ObjectId();

  function roleDeps(targetRole: string, overrides: Partial<CorporateUsersDeps> = {}) {
    return createDeps({
      findUser: jest
        .fn()
        .mockResolvedValue(mockUser({ _id: new Types.ObjectId(targetId), role: targetRole })),
      updateUser: jest.fn().mockResolvedValue(mockUser({ role: 'USER' })),
      getUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId })),
      ...overrides,
    });
  }

  it('sets HEAD', async () => {
    const deps = roleDeps(SystemRoles.USER);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: targetId },
      body: { role: 'HEAD' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateUser).toHaveBeenCalledWith(targetId, { role: 'HEAD' });
    expect(json.mock.calls[0][0].user.role).toBe('HEAD');
  });

  it('sets USER', async () => {
    const deps = roleDeps(SystemRoles.HEAD);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: targetId },
      body: { role: 'USER' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateUser).toHaveBeenCalledWith(targetId, { role: 'USER' });
    expect(json.mock.calls[0][0].user.role).toBe('USER');
  });

  it('resolves the target by employeeId', async () => {
    const employeeId = '0b4f7c2e-8a3d-4f6e-9c1a-2d5e7f9a1b3c';
    const deps = roleDeps(SystemRoles.USER);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: employeeId },
      body: { role: 'HEAD' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.findUser).toHaveBeenCalledWith({ employeeId }, expect.any(String));
    expect(deps.updateUser).toHaveBeenCalledWith(targetId, { role: 'HEAD' });
  });

  it.each([SystemRoles.ADMIN, SystemRoles.OWNER])('409 for admin target %s', async (targetRole) => {
    const deps = roleDeps(targetRole);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: targetId },
      body: { role: 'USER' },
      caller: { role: SystemRoles.OWNER },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'TARGET_IS_ADMIN' }));
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it.each(['SPACE_ASSISTANT', 'custom-role'])('409 for unmanaged role %s', async (targetRole) => {
    const deps = roleDeps(targetRole);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: targetId },
      body: { role: 'USER' },
      caller: { role: SystemRoles.OWNER },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'ROLE_NOT_MANAGED' }));
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('400 head without department', async () => {
    const deps = roleDeps(SystemRoles.USER, {
      getUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId: null })),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: targetId },
      body: { role: 'HEAD' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error_code: 'HEAD_REQUIRES_DEPARTMENT' }),
    );
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('403 for own role', async () => {
    const deps = roleDeps(SystemRoles.ADMIN);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: targetId },
      body: { role: 'USER' },
      caller: { id: targetId, role: SystemRoles.ADMIN },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('403 for head caller', async () => {
    const deps = roleDeps(SystemRoles.USER);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: targetId },
      body: { role: 'HEAD' },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it.each([['ADMIN'], ['OWNER'], ['custom'], [''], [undefined]])(
    'rejects role %s as not assignable',
    async (role) => {
      const deps = roleDeps(SystemRoles.USER);
      const handlers = createCorporateUsersHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: targetId },
        body: { role },
      });

      await handlers.updateUserAiRole(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error_code: 'INVALID_ROLE' }));
      expect(deps.updateUser).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed user id', async () => {
    const deps = roleDeps(SystemRoles.USER);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({ params: { id: 'nope' }, body: { role: 'USER' } });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.findUser).not.toHaveBeenCalled();
  });

  it('returns 404 when the target does not exist', async () => {
    const deps = roleDeps(SystemRoles.USER, { findUser: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: targetId },
      body: { role: 'USER' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('is a no-op when the role is already what was asked for', async () => {
    const deps = roleDeps(SystemRoles.HEAD);
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: targetId },
      body: { role: 'HEAD' },
    });

    await handlers.updateUserAiRole(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });
});

describe('createCorporateUsersHandlers owner protection', () => {
  const ownerId = new Types.ObjectId().toString();

  /**
   * Защита роли без этой проверки бесполезна: администратор добился бы того же
   * результата, просто заблокировав владельца.
   */
  it.each([
    ['limits', { limits: null }],
    ['canUploadKnowledge', { canUploadKnowledge: false }],
  ])('refuses an admin editing %s on an owner', async (_field, body) => {
    const deps = createDeps({
      findUser: jest.fn().mockResolvedValue(mockUser({ role: SystemRoles.OWNER })),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({ params: { id: ownerId }, body });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Only an owner can modify an owner' });
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('lets an owner edit another owner', async () => {
    const deps = createDeps({
      findUser: jest.fn().mockResolvedValue(mockUser({ role: SystemRoles.OWNER })),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: ownerId },
      body: { limits: null },
      caller: { role: SystemRoles.OWNER },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.upsertUserPolicy).toHaveBeenCalled();
  });
});

describe('createCorporateUsersHandlers defaultModel', () => {
  const validId = new Types.ObjectId().toString();

  function depsWithUser(overrides: Partial<CorporateUsersDeps> = {}) {
    return createDeps({
      findUser: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(validId),
        name: 'Ann',
        email: 'ann@example.com',
        role: 'USER',
      }),
      ...overrides,
    });
  }

  it('отклоняет персональный дефолт вне персонального списка', async () => {
    const deps = depsWithUser();
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: validId },
      body: { allowedModels: ['a'], defaultModel: 'b' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'defaultModel must be one of allowedModels' });
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('сохраняет список и дефолт вместе', async () => {
    const deps = depsWithUser();
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res } = createReqRes({
      params: { id: validId },
      body: { allowedModels: ['a', 'b'], defaultModel: 'b' },
    });

    await handlers.updateUser(req, res);

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(
      validId,
      expect.objectContaining({ allowedModels: ['a', 'b'], defaultModel: 'b' }),
    );
  });

  it('сбрасывает дефолт вместе со снятым персональным списком', async () => {
    const deps = depsWithUser();
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res } = createReqRes({
      params: { id: validId },
      body: { allowedModels: null },
    });

    await handlers.updateUser(req, res);

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(
      validId,
      expect.objectContaining({ allowedModels: null, defaultModel: null }),
    );
  });
});

describe('createCorporateUsersHandlers department scope', () => {
  it('listUsers rejects an employee outright', async () => {
    const deps = createDeps();
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({ caller: { role: 'USER' } });

    await handlers.listUsers(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.listAdminUserPage).not.toHaveBeenCalled();
  });

  it('listUsers rejects a department head with no department of their own', async () => {
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }) });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({ caller: { role: 'HEAD' } });

    await handlers.listUsers(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.listAdminUserPage).not.toHaveBeenCalled();
  });

  it("listUsers forces the query to the head's own department even if a different one was requested", async () => {
    const ownDepartmentId = new Types.ObjectId().toString();
    const otherDepartmentId = new Types.ObjectId().toString();
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId: ownDepartmentId }),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      query: { departmentId: otherDepartmentId },
      caller: { role: 'HEAD' },
    });

    await handlers.listUsers(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.listAdminUserPage).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: ownDepartmentId }),
    );
  });

  it('getUser refuses a head reading someone outside their department', async () => {
    const departmentId = new Types.ObjectId().toString();
    const otherDepartmentId = new Types.ObjectId();
    const user = mockUser();
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      findUser: jest.fn().mockResolvedValue(user),
      listUserPolicies: jest
        .fn()
        .mockResolvedValue(
          new Map([[user._id.toString(), mockPolicy({ departmentId: otherDepartmentId })]]),
        ),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: user._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.getUser(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });

  it('getUser lets a head read someone in their own department', async () => {
    const departmentId = new Types.ObjectId();
    const user = mockUser();
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      findUser: jest.fn().mockResolvedValue(user),
      listUserPolicies: jest
        .fn()
        .mockResolvedValue(new Map([[user._id.toString(), mockPolicy({ departmentId })]])),
      getGlobalSettings: jest.fn().mockResolvedValue({
        systemPrompt: 'global',
        allowedModels: ['gpt-4'],
        defaultModel: 'gpt-4',
        defaultLimits: NO_LIMITS,
      }),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: user._id.toString() },
      caller: { role: 'HEAD' },
    });

    await handlers.getUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it('updateUser refuses a head changing a field outside their allowance', async () => {
    const departmentId = new Types.ObjectId();
    const user = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      findUser: jest.fn().mockResolvedValue(user),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: user._id.toString() },
      body: { limits: { dailyCostUsd: 1 } },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('updateUser refuses a head targeting someone outside their department', async () => {
    const departmentId = new Types.ObjectId();
    const otherDepartmentId = new Types.ObjectId();
    const user = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockImplementation(async (id: string) => {
        if (id === user._id.toString()) {
          return mockPolicy({ departmentId: otherDepartmentId });
        }
        return { departmentId };
      }),
      findUser: jest.fn().mockResolvedValue(user),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: user._id.toString() },
      body: { canUploadKnowledge: true },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('updateUser allows a head to change upload access for their own department', async () => {
    const departmentId = new Types.ObjectId();
    const user = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId })),
      findUser: jest.fn().mockResolvedValue(user),
      upsertUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId })),
      getGlobalSettings: jest.fn().mockResolvedValue({
        systemPrompt: 'global',
        allowedModels: ['gpt-4'],
        defaultModel: 'gpt-4',
        defaultLimits: NO_LIMITS,
      }),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: user._id.toString() },
      body: { canUploadKnowledge: true },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(
      user._id.toString(),
      expect.objectContaining({ canUploadKnowledge: true }),
    );
  });

  it('updateUser отказывает главе, пытающейся выдать пространство чужого отдела через allowedSpaces', async () => {
    const departmentId = new Types.ObjectId();
    const ownSpace = mockSpace({ allowedDepartments: [departmentId] });
    const foreignSpace = mockSpace({ allowedDepartments: [new Types.ObjectId()] });
    const target = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockImplementation(async (id: string) => {
        if (id === target._id.toString()) {
          return mockPolicy({ departmentId });
        }
        return { departmentId };
      }),
      findUser: jest.fn().mockResolvedValue(target),
      listSpaces: jest.fn().mockResolvedValue([ownSpace, foreignSpace]),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: target._id.toString() },
      body: { allowedSpaces: [foreignSpace._id.toString()] },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('updateUser разрешает главе выдать пространство собственного отдела через allowedSpaces', async () => {
    const departmentId = new Types.ObjectId();
    const ownSpace = mockSpace({ allowedDepartments: [departmentId] });
    const target = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockImplementation(async (id: string) => {
        if (id === target._id.toString()) {
          return mockPolicy({ departmentId });
        }
        return { departmentId };
      }),
      findUser: jest.fn().mockResolvedValue(target),
      listSpaces: jest.fn().mockResolvedValue([ownSpace]),
      upsertUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId })),
      getGlobalSettings: jest.fn().mockResolvedValue({
        systemPrompt: 'global',
        allowedModels: ['gpt-4'],
        defaultModel: 'gpt-4',
        defaultLimits: NO_LIMITS,
      }),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: target._id.toString() },
      body: { allowedSpaces: [ownSpace._id.toString()] },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(
      target._id.toString(),
      expect.objectContaining({ allowedSpaces: [ownSpace._id.toString()] }),
    );
  });

  it('updateUser разрешает главе запретить подчинённому общекорпоративное пространство через deniedSpaces', async () => {
    const departmentId = new Types.ObjectId();
    // Пространство «для всех»: пустой allowedDepartments, к отделу главы не привязано.
    const openSpace = mockSpace({ allowedDepartments: [] });
    const target = mockUser({ role: 'USER' });
    const deps = createDeps({
      getUserPolicy: jest.fn().mockImplementation(async (id: string) => {
        if (id === target._id.toString()) {
          return mockPolicy({ departmentId });
        }
        return { departmentId };
      }),
      findUser: jest.fn().mockResolvedValue(target),
      listSpaces: jest.fn().mockResolvedValue([openSpace]),
      upsertUserPolicy: jest.fn().mockResolvedValue(mockPolicy({ departmentId })),
      getGlobalSettings: jest.fn().mockResolvedValue({
        systemPrompt: 'global',
        allowedModels: ['gpt-4'],
        defaultModel: 'gpt-4',
        defaultLimits: NO_LIMITS,
      }),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: target._id.toString() },
      body: { deniedSpaces: [openSpace._id.toString()] },
      caller: { role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(
      target._id.toString(),
      expect.objectContaining({ deniedSpaces: [openSpace._id.toString()] }),
    );
  });

  it('updateUser отказывает главе, сохраняющей собственную карточку целиком', async () => {
    const departmentId = new Types.ObjectId();
    const ownSpace = mockSpace({ allowedDepartments: [departmentId] });
    const self = mockUser({ role: 'HEAD' });
    const selfId = self._id.toString();
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId }),
      findUser: jest.fn().mockResolvedValue(self),
      listSpaces: jest.fn().mockResolvedValue([ownSpace]),
    });
    const handlers = createCorporateUsersHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: selfId },
      /**
       * Тело, которое реально формирует форма карточки сотрудника при сохранении, —
       * оба поля, доступных главе, разом (`canUploadKnowledge` и `allowedSpaces`),
       * а не одно из них по отдельности, как удобнее для теста, но не отражает
       * реальный запрос клиента.
       */
      body: { canUploadKnowledge: true, allowedSpaces: [ownSpace._id.toString()] },
      caller: { id: selfId, role: 'HEAD' },
    });

    await handlers.updateUser(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    /** Запрет на самоправку срабатывает раньше проверки пространств, а не вместо неё. */
    expect(deps.listSpaces).not.toHaveBeenCalled();
  });
});
