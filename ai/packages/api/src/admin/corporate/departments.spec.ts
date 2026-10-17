import { Types } from 'mongoose';
import type { IDepartment } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateDepartmentsDeps } from './departments';
import { createCorporateDepartmentsHandlers } from './departments';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NO_LIMITS = {
  dailyCostUsd: null,
};

function mockDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: new Types.ObjectId(),
    name: 'Sales',
    allowedModels: ['gpt-4'],
    defaultLimits: NO_LIMITS,
    ...overrides,
  } as IDepartment;
}

function createReqRes(overrides: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  role?: string;
}) {
  const req = {
    params: overrides.params ?? {},
    query: {},
    body: overrides.body ?? {},
    user: { _id: new Types.ObjectId(), role: overrides.role ?? 'ADMIN' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<CorporateDepartmentsDeps> = {}): CorporateDepartmentsDeps {
  return {
    listDepartments: jest.fn().mockResolvedValue([]),
    getDepartmentById: jest.fn().mockResolvedValue(mockDepartment()),
    updateDepartment: jest.fn().mockResolvedValue(mockDepartment()),
    ...overrides,
  };
}

describe('createCorporateDepartmentsHandlers', () => {
  it('lists departments', async () => {
    const departments = [
      mockDepartment({ name: 'Sales', directoryId: 'dir-1' }),
      mockDepartment({ name: 'Legal' }),
    ];
    const deps = createDeps({ listDepartments: jest.fn().mockResolvedValue(departments) });
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status, json } = createReqRes({});

    await handlers.listDepartments(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const items = json.mock.calls[0][0].departments;
    expect(items).toHaveLength(2);
    expect(items[0].directoryId).toBe('dir-1');
    expect(items[1].directoryId).toBeNull();
  });

  it('rejects the removed request-count field on update', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const validId = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({
      params: { id: validId },
      body: { defaultLimits: { dailyRequests: 2.5 } },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });

  it('returns 404 when updating a department that does not exist', async () => {
    const deps = createDeps({ updateDepartment: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateDepartmentsHandlers(deps);
    const validId = new Types.ObjectId().toString();
    const { req, res, status } = createReqRes({
      params: { id: validId },
      body: { systemPrompt: 'X' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('rejects a malformed department id on update', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: 'nope' },
      body: { systemPrompt: 'X' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });

  it.each([
    ['name', { name: 'Renamed' }],
    ['description', { description: 'New text' }],
  ])('rejects %s with FIELD_NOT_EDITABLE', async (_field, body) => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id: new Types.ObjectId().toString() },
      body,
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error_code: 'FIELD_NOT_EDITABLE' }),
    );
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });

  it('resolves department by directoryId', async () => {
    const directoryId = '5e1f9c4a-3b7d-4e2a-8c6f-1a9b0d2e4f68';
    const department = mockDepartment({ directoryId });
    const deps = createDeps({
      listDepartments: jest.fn().mockResolvedValue([mockDepartment(), department]),
      updateDepartment: jest.fn().mockResolvedValue(department),
    });
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: directoryId },
      body: { systemPrompt: 'Отвечай кратко' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.updateDepartment).toHaveBeenCalledWith(department._id.toString(), {
      systemPrompt: 'Отвечай кратко',
    });
  });

  it('returns 404 for an unknown directoryId', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id: '5e1f9c4a-3b7d-4e2a-8c6f-1a9b0d2e4f68' },
      body: { systemPrompt: 'X' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });
});

describe('createCorporateDepartmentsHandlers defaultModel', () => {
  const id = new Types.ObjectId().toString();

  it('отклоняет обновление, когда дефолт вне списка', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status, json } = createReqRes({
      params: { id },
      body: { allowedModels: ['a'], defaultModel: 'b' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'defaultModel must be one of allowedModels' });
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });

  it('требует дефолт, когда список задан только в теле', async () => {
    const deps = createDeps({
      getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ allowedModels: [] })),
    });
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({
      params: { id },
      body: { allowedModels: ['a', 'b'] },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('сохраняет согласованную пару', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res } = createReqRes({
      params: { id },
      body: { allowedModels: ['a', 'b'], defaultModel: 'b' },
    });

    await handlers.updateDepartment(req, res);

    expect(deps.updateDepartment).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ allowedModels: ['a', 'b'], defaultModel: 'b' }),
    );
  });

  it('не читает отдел, когда модели в теле не пришли', async () => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res } = createReqRes({ params: { id }, body: { systemPrompt: 'Отвечай кратко' } });

    await handlers.updateDepartment(req, res);

    expect(deps.getDepartmentById).not.toHaveBeenCalled();
  });
});

describe('createCorporateDepartmentsHandlers department scope', () => {
  it.each(['HEAD', 'USER'])('%s cannot list departments', async (role) => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({ role });

    await handlers.listDepartments(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.listDepartments).not.toHaveBeenCalled();
  });

  it.each(['HEAD', 'USER'])('%s cannot update a department', async (role) => {
    const deps = createDeps();
    const handlers = createCorporateDepartmentsHandlers(deps);
    const { req, res, status } = createReqRes({
      role,
      params: { id: 'dep-1' },
      body: { systemPrompt: 'X' },
    });

    await handlers.updateDepartment(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(deps.updateDepartment).not.toHaveBeenCalled();
  });
});
