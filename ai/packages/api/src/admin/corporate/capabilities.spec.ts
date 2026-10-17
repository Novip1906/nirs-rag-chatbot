import { PrincipalType } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ResolvedPrincipal } from '~/types/principal';
import type { ServerRequest } from '~/types/http';
import type { CorporateCapabilitiesDeps } from './capabilities';
import { createCorporateCapabilitiesHandlers } from './capabilities';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(caller: { id?: string; role?: string } = {}) {
  const req = {
    params: {},
    query: {},
    body: {},
    user: { _id: caller.id ?? 'u1', role: caller.role ?? 'HEAD' },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

const somePrincipals: ResolvedPrincipal[] = [
  { principalType: PrincipalType.USER, principalId: 'u1' },
];

function createDeps(overrides: Partial<CorporateCapabilitiesDeps> = {}): CorporateCapabilitiesDeps {
  return {
    getUserPrincipals: jest.fn().mockResolvedValue(somePrincipals),
    getHeldCapabilities: jest.fn().mockResolvedValue(new Set(['access:admin', 'read:users'])),
    getUserPolicy: jest.fn().mockResolvedValue({ departmentId: 'dep-1' }),
    getDepartmentById: jest.fn().mockResolvedValue({ name: 'IT' }),
    ...overrides,
  };
}

describe('createCorporateCapabilitiesHandlers', () => {
  it('отдаёт удерживаемые capability вместе с отделом и его названием', async () => {
    const deps = createDeps();
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res, status } = createReqRes({ id: 'u1', role: 'HEAD' });

    await handlers.getMyCapabilities(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      capabilities: ['access:admin', 'read:users'],
      role: 'HEAD',
      departmentId: 'dep-1',
      departmentName: 'IT',
    });
    expect(deps.getDepartmentById).toHaveBeenCalledWith('dep-1');
  });

  it('для админа отдел и его название в ответе null, даже если политика существует', async () => {
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res } = createReqRes({ id: 'admin-1', role: 'ADMIN' });

    await handlers.getMyCapabilities(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN', departmentId: null, departmentName: null }),
    );
    expect(deps.getDepartmentById).not.toHaveBeenCalled();
  });

  it('название отдела null, если отдел уже удалён (departmentId остался в политике, а документа нет)', async () => {
    const deps = createDeps({ getDepartmentById: jest.fn().mockResolvedValue(null) });
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res } = createReqRes({ id: 'u1', role: 'HEAD' });

    await handlers.getMyCapabilities(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ departmentId: 'dep-1', departmentName: null }),
    );
  });

  it('пользуется закэшированными в рамках запроса принципалами и не читает их из базы заново', async () => {
    const getCachedPrincipals = jest.fn().mockReturnValue(somePrincipals);
    const deps = createDeps({ getCachedPrincipals });
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res } = createReqRes({ id: 'u1', role: 'HEAD' });

    await handlers.getMyCapabilities(req, res);

    expect(getCachedPrincipals).toHaveBeenCalledWith({
      id: 'u1',
      role: 'HEAD',
      tenantId: undefined,
    });
    expect(deps.getUserPrincipals).not.toHaveBeenCalled();
    expect(deps.getHeldCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ principals: somePrincipals }),
    );
  });

  it('без кэша (или на промахе) разрешает принципалы через getUserPrincipals', async () => {
    const getCachedPrincipals = jest.fn().mockReturnValue(undefined);
    const deps = createDeps({ getCachedPrincipals });
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res } = createReqRes({ id: 'u1', role: 'HEAD' });

    await handlers.getMyCapabilities(req, res);

    expect(deps.getUserPrincipals).toHaveBeenCalledWith({
      userId: 'u1',
      role: 'HEAD',
      tenantId: undefined,
    });
  });

  it('отвечает 500, если чтение зависимостей падает', async () => {
    const deps = createDeps({
      getHeldCapabilities: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const handlers = createCorporateCapabilitiesHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.getMyCapabilities(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});
