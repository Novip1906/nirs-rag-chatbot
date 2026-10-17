jest.mock('~/models');
jest.mock('~/server/services/oidcTokenVerifier', () => ({
  ...jest.requireActual('~/server/services/oidcTokenVerifier'),
  getProcessVerifier: jest.fn(),
}));
jest.mock('~/server/services/directorySyncDeps', () => ({
  buildDirectorySyncDeps: jest.fn(() => ({ marker: 'deps' })),
}));

const express = require('express');
const request = require('supertest');
const { invalidateBlockedUser } = require('@librechat/api');
const db = require('~/models');
const { getProcessVerifier } = require('~/server/services/oidcTokenVerifier');
const { createRequireAdminToken } = require('./requireAdminToken');

const USER = { _id: { toString: () => 'user-1' }, openidId: 'sub-1', role: 'ADMIN' };
const GOOD_CLAIMS = { sub: 'sub-1', azp: 'admin', aud: ['admin-api', 'corporate-ai'] };

function setup({
  claims = GOOD_CLAIMS,
  users = [{ ...USER }],
  mode = 'apply',
  employee = { ok: true, value: { id: 'emp-1', sub: 'sub-1' } },
} = {}) {
  const store = [...users];
  const verify = jest.fn().mockImplementation(async () => {
    if (claims instanceof Error) {
      throw claims;
    }
    return claims;
  });
  const client = {
    getEmployeeBySub: jest.fn().mockResolvedValue(employee),
    listDepartments: jest.fn().mockResolvedValue({ ok: true, value: [] }),
  };
  const syncDeps = { marker: 'deps', listDepartments: jest.fn().mockResolvedValue([]) };
  const syncDepartment = jest.fn();
  const syncEmployee = jest.fn().mockImplementation(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    store.push({ ...USER });
    return { userId: 'user-1' };
  });
  const findUser = jest
    .fn()
    .mockImplementation(
      async (criteria) => store.find((u) => u.openidId === criteria.openidId) ?? null,
    );
  const middleware = createRequireAdminToken({
    verify,
    client,
    syncDeps,
    syncDepartment,
    syncEmployee,
    findUser,
    getMode: () => mode,
  });
  const app = express();
  app.get('/admin/ping', middleware, (req, res) =>
    res.json({ id: req.user.id, role: req.user.role }),
  );
  return { app, verify, client, syncEmployee, syncDeps, syncDepartment, findUser };
}

const get = (app, token = 'tok') =>
  request(app)
    .get('/admin/ping')
    .set(token ? { Authorization: `Bearer ${token}` } : {});

describe('requireAdminToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateBlockedUser('user-1');
    db.getUserPolicy.mockResolvedValue(null);
    delete process.env.ADMIN_OIDC_AUDIENCE;
    delete process.env.ADMIN_OIDC_CLIENT;
  });

  it('401 without bearer', async () => {
    const { app, verify } = setup();
    const res = await get(app, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('401 for invalid signature', async () => {
    const { app, findUser } = setup({
      claims: Object.assign(new Error('x'), { reason: 'invalid' }),
    });
    const res = await get(app);
    expect(res.status).toBe(401);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('401 for expired token', async () => {
    const { app } = setup({ claims: Object.assign(new Error('x'), { reason: 'expired' }) });
    expect((await get(app)).status).toBe(401);
  });

  it('rejects token without admin audience', async () => {
    const { app, findUser } = setup({ claims: { ...GOOD_CLAIMS, aud: 'admin-api' } });
    const res = await get(app);
    expect(res.status).toBe(401);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('rejects token without audience claim', async () => {
    const { app } = setup({ claims: { sub: 'sub-1', azp: 'admin' } });
    expect((await get(app)).status).toBe(401);
  });

  it('rejects token of another client', async () => {
    const { app, findUser } = setup({ claims: { ...GOOD_CLAIMS, azp: 'librechat' } });
    const res = await get(app);
    expect(res.status).toBe(401);
    expect(findUser).not.toHaveBeenCalled();
  });

  it('rejects token without azp', async () => {
    const { app } = setup({ claims: { sub: 'sub-1', aud: 'corporate-ai' } });
    expect((await get(app)).status).toBe(401);
  });

  it('honours audience and client from env', async () => {
    process.env.ADMIN_OIDC_AUDIENCE = 'custom-aud';
    process.env.ADMIN_OIDC_CLIENT = 'custom-client';
    const { app } = setup({ claims: { sub: 'sub-1', azp: 'custom-client', aud: 'custom-aud' } });
    expect((await get(app)).status).toBe(200);
  });

  it('sets req.user for known subject', async () => {
    const { app, syncEmployee } = setup();
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'user-1', role: 'ADMIN' });
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('provisions unknown subject on first admin request', async () => {
    const { app, client, syncEmployee, syncDeps } = setup({ users: [] });
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(client.getEmployeeBySub).toHaveBeenCalledWith('sub-1');
    expect(syncEmployee).toHaveBeenCalledWith(syncDeps, { id: 'emp-1', sub: 'sub-1' });
    expect(res.body.id).toBe('user-1');
  });

  it('does not provision unless sync mode is apply', async () => {
    const { app, client } = setup({ users: [], mode: 'report' });
    expect((await get(app)).status).toBe(401);
    expect(client.getEmployeeBySub).not.toHaveBeenCalled();
  });

  it('401 when directory does not know subject', async () => {
    const { app, syncEmployee } = setup({
      users: [],
      employee: { ok: false, reason: 'not_found' },
    });
    const res = await get(app);
    expect(res.status).toBe(401);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('401 when the employee is still unknown after sync', async () => {
    const { app, syncEmployee } = setup({ users: [] });
    syncEmployee.mockResolvedValue({ userId: null });
    const res = await get(app);
    expect(res.status).toBe(401);
  });

  it('503 when directory is unavailable', async () => {
    const { app } = setup({ users: [], employee: { ok: false, reason: 'unavailable' } });
    expect((await get(app)).status).toBe(503);
  });

  it('403 corporate_blocked for blocked user', async () => {
    db.getUserPolicy.mockResolvedValue({ blocked: true });
    const { app } = setup();
    const res = await get(app);
    expect(res.status).toBe(403);
    expect(res.body.type).toBe('corporate_blocked');
  });

  it('concurrent first requests share one provisioning', async () => {
    const { app, client, syncEmployee } = setup({ users: [] });
    const responses = await Promise.all([get(app), get(app), get(app)]);
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(client.getEmployeeBySub).toHaveBeenCalledTimes(1);
    expect(syncEmployee).toHaveBeenCalledTimes(1);
  });

  it('syncs the employee department before provisioning', async () => {
    const calls = [];
    const department = { id: 'dep-1', name: 'Sales' };
    const { app, client, syncEmployee, syncDepartment, syncDeps } = setup({
      users: [],
      employee: { ok: true, value: { id: 'emp-1', sub: 'sub-1', department_id: 'dep-1' } },
    });
    client.listDepartments.mockResolvedValue({ ok: true, value: [department] });
    syncDepartment.mockImplementation(async () => calls.push('department'));
    const original = syncEmployee.getMockImplementation();
    syncEmployee.mockImplementation(async (...args) => {
      calls.push('employee');
      return original(...args);
    });
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(syncDepartment).toHaveBeenCalledWith(syncDeps, department);
    expect(calls).toEqual(['department', 'employee']);
  });

  it('does not sync a department that is already known', async () => {
    const { app, syncDepartment, syncDeps } = setup({
      users: [],
      employee: { ok: true, value: { id: 'emp-1', sub: 'sub-1', department_id: 'dep-1' } },
    });
    syncDeps.listDepartments.mockResolvedValue([{ directoryId: 'dep-1' }]);
    expect((await get(app)).status).toBe(200);
    expect(syncDepartment).not.toHaveBeenCalled();
  });

  it('503 when the directory cannot list departments', async () => {
    const { app, client, syncEmployee } = setup({
      users: [],
      employee: { ok: true, value: { id: 'emp-1', sub: 'sub-1', department_id: 'dep-1' } },
    });
    client.listDepartments.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await get(app)).status).toBe(503);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('503 when the issuer is not configured', async () => {
    getProcessVerifier.mockReturnValue(null);
    const middleware = createRequireAdminToken({ getMode: () => 'apply' });
    const app = express();
    app.get('/admin/ping', middleware, (req, res) => res.json({}));
    const res = await get(app);
    expect(res.status).toBe(503);
  });
});
