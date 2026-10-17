const express = require('express');
const request = require('supertest');

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  createDirectoryClient: jest.fn(),
  syncDirectoryEmployee: jest.fn(),
  syncDirectoryDepartment: jest.fn(),
}));
jest.mock('~/server/services/oidcTokenVerifier', () => ({
  ...jest.requireActual('~/server/services/oidcTokenVerifier'),
  getProcessVerifier: jest.fn(),
}));
jest.mock('~/server/services/directorySyncDeps', () => ({
  buildDirectorySyncDeps: jest.fn(),
}));

const { getProcessVerifier } = require('~/server/services/oidcTokenVerifier');
const { createDirectoryRouter } = require('./directory');

const EMP_ID = '5f1c0d8e-3b6a-4c1f-9a7e-0d2b4c6e8f10';
const DEP_ID = '7a2b4c6d-1e3f-4a5b-8c9d-0e1f2a3b4c5d';

const EMPLOYEE = { id: EMP_ID, sub: 'sub-1', department_id: null };
const DEPARTMENT = { id: DEP_ID, name: 'Sales' };

function setup({
  mode = 'apply',
  claims = { azp: 'admin-api-notify', aud: ['admin-api', 'corporate-ai'] },
} = {}) {
  const calls = [];
  const verify = jest.fn().mockImplementation(async () => {
    if (claims instanceof Error) {
      throw claims;
    }
    return claims;
  });
  const client = {
    getEmployee: jest.fn().mockResolvedValue({ ok: true, value: EMPLOYEE }),
    listDepartments: jest.fn().mockResolvedValue({ ok: true, value: [DEPARTMENT] }),
  };
  const syncDeps = { listDepartments: jest.fn().mockResolvedValue([]) };
  const syncEmployee = jest.fn().mockImplementation(async () => {
    calls.push('employee');
    return { userId: 'u1' };
  });
  const syncDepartment = jest.fn().mockImplementation(async () => {
    calls.push('department');
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin-api',
    createDirectoryRouter({
      verify,
      client,
      syncDeps,
      syncEmployee,
      syncDepartment,
      getMode: () => mode,
    }),
  );
  return { app, verify, client, syncDeps, syncEmployee, syncDepartment, calls };
}

const post = (app, body = { type: 'employee', id: EMP_ID }) =>
  request(app).post('/api/admin-api/notify').set('Authorization', 'Bearer tok').send(body);

describe('POST /api/admin-api/notify', () => {
  it('401 without token', async () => {
    const { app, verify } = setup();
    const res = await request(app)
      .post('/api/admin-api/notify')
      .send({ type: 'employee', id: EMP_ID });
    expect(res.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('401 for an invalid or expired token', async () => {
    const error = Object.assign(new Error('bad'), { reason: 'invalid' });
    const { app, syncEmployee } = setup({ claims: error });
    const res = await post(app);
    expect(res.status).toBe(401);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('502 when token keys are unavailable', async () => {
    const error = Object.assign(new Error('down'), { reason: 'unavailable' });
    const { app } = setup({ claims: error });
    expect((await post(app)).status).toBe(502);
  });

  it('403 for foreign client', async () => {
    const { app, syncEmployee } = setup({ claims: { azp: 'librechat' } });
    const res = await post(app);
    expect(res.status).toBe(403);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('400 for bad body', async () => {
    const { app } = setup();
    expect((await post(app, { type: 'user', id: 'x' })).status).toBe(400);
    expect((await post(app, { type: 'employee' })).status).toBe(400);
    expect((await post(app, { type: 'employee', id: 5 })).status).toBe(400);
  });

  it('400 when id is not a UUID', async () => {
    const { app, client, syncEmployee } = setup();
    expect((await post(app, { type: 'employee', id: '..' })).status).toBe(400);
    expect((await post(app, { type: 'employee', id: 'emp-1' })).status).toBe(400);
    expect((await post(app, { type: 'department', id: '../x' })).status).toBe(400);
    expect(client.getEmployee).not.toHaveBeenCalled();
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('403 when the token has no notification audience', async () => {
    const { app, syncEmployee } = setup({
      claims: { azp: 'admin-api-notify', aud: 'admin-api' },
    });
    expect((await post(app)).status).toBe(403);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('403 when the token has no audience at all', async () => {
    const { app } = setup({ claims: { azp: 'admin-api-notify' } });
    expect((await post(app)).status).toBe(403);
  });

  it('accepts the audience as a string', async () => {
    const { app } = setup({ claims: { azp: 'admin-api-notify', aud: 'corporate-ai' } });
    expect((await post(app)).status).toBe(204);
  });

  it('honours ADMIN_API_NOTIFY_AUDIENCE', async () => {
    process.env.ADMIN_API_NOTIFY_AUDIENCE = 'other-aud';
    try {
      const { app } = setup({ claims: { azp: 'admin-api-notify', aud: 'other-aud' } });
      expect((await post(app)).status).toBe(204);
      const denied = setup({ claims: { azp: 'admin-api-notify', aud: 'corporate-ai' } });
      expect((await post(denied.app)).status).toBe(403);
    } finally {
      delete process.env.ADMIN_API_NOTIFY_AUDIENCE;
    }
  });

  it('503 when the issuer is not configured', async () => {
    getProcessVerifier.mockReturnValue(null);
    const app = express();
    app.use(express.json());
    app.use('/api/admin-api', createDirectoryRouter({ getMode: () => 'apply' }));
    const res = await post(app);
    expect(res.status).toBe(503);
  });

  it('204 and syncs employee', async () => {
    const { app, client, syncEmployee, syncDeps } = setup();
    const res = await post(app);
    expect(res.status).toBe(204);
    expect(client.getEmployee).toHaveBeenCalledWith(EMP_ID);
    expect(syncEmployee).toHaveBeenCalledWith(syncDeps, EMPLOYEE);
  });

  it('204 and syncs department', async () => {
    const { app, syncDepartment, syncDeps, syncEmployee } = setup();
    const res = await post(app, { type: 'department', id: DEP_ID });
    expect(res.status).toBe(204);
    expect(syncDepartment).toHaveBeenCalledWith(syncDeps, DEPARTMENT);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('syncs department before employee when department unknown', async () => {
    const { app, client, syncDeps, calls, syncDepartment } = setup();
    client.getEmployee.mockResolvedValue({
      ok: true,
      value: { ...EMPLOYEE, department_id: DEP_ID },
    });
    const res = await post(app);
    expect(res.status).toBe(204);
    expect(syncDepartment).toHaveBeenCalledWith(syncDeps, DEPARTMENT);
    expect(calls).toEqual(['department', 'employee']);
  });

  it('does not sync department that is already known', async () => {
    const { app, client, syncDeps, syncDepartment, syncEmployee } = setup();
    client.getEmployee.mockResolvedValue({
      ok: true,
      value: { ...EMPLOYEE, department_id: DEP_ID },
    });
    syncDeps.listDepartments.mockResolvedValue([{ directoryId: DEP_ID }]);
    const res = await post(app);
    expect(res.status).toBe(204);
    expect(syncDepartment).not.toHaveBeenCalled();
    expect(syncEmployee).toHaveBeenCalled();
  });

  it('502 when directory unavailable', async () => {
    const { app, client, syncEmployee } = setup();
    client.getEmployee.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await post(app);
    expect(res.status).toBe(502);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('502 when department lookup is unavailable', async () => {
    const { app, client, syncEmployee } = setup();
    client.getEmployee.mockResolvedValue({
      ok: true,
      value: { ...EMPLOYEE, department_id: DEP_ID },
    });
    client.listDepartments.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const res = await post(app);
    expect(res.status).toBe(502);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('204 without changes when the record is gone', async () => {
    const { app, client, syncEmployee } = setup();
    client.getEmployee.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await post(app);
    expect(res.status).toBe(204);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('500 when applying fails', async () => {
    const { app, syncEmployee } = setup();
    syncEmployee.mockRejectedValue(new Error('mongo down'));
    expect((await post(app)).status).toBe(500);
  });

  it('204 no-op when sync mode is report', async () => {
    const { app, client, syncEmployee, syncDepartment } = setup({ mode: 'report' });
    const res = await post(app);
    expect(res.status).toBe(204);
    expect(client.getEmployee).not.toHaveBeenCalled();
    expect(syncEmployee).not.toHaveBeenCalled();
    expect(syncDepartment).not.toHaveBeenCalled();
  });

  it('204 no-op when sync mode is unset', async () => {
    const { app, syncEmployee } = setup({ mode: null });
    expect((await post(app)).status).toBe(204);
    expect(syncEmployee).not.toHaveBeenCalled();
  });

  it('honours ADMIN_API_NOTIFY_CLIENT', async () => {
    process.env.ADMIN_API_NOTIFY_CLIENT = 'custom-client';
    try {
      const { app } = setup({ claims: { azp: 'custom-client', aud: 'corporate-ai' } });
      expect((await post(app)).status).toBe(204);
    } finally {
      delete process.env.ADMIN_API_NOTIFY_CLIENT;
    }
  });
});
