import { SystemRoles } from 'librechat-data-provider';
import type { DepartmentScopeDeps } from './departmentScope';
import { resolveDepartmentScope, resolveRequestDepartmentScope } from './departmentScope';

describe('resolveDepartmentScope', () => {
  it('админа не ограничивает', () => {
    expect(resolveDepartmentScope({ role: 'ADMIN', departmentId: 'dep-1' })).toEqual({
      ok: true,
      departmentId: null,
    });
  });

  it('владельца не ограничивает', () => {
    expect(resolveDepartmentScope({ role: 'OWNER', departmentId: 'dep-1' })).toEqual({
      ok: true,
      departmentId: null,
    });
  });

  it('главу сужает до его отдела', () => {
    expect(resolveDepartmentScope({ role: 'HEAD', departmentId: 'dep-1' })).toEqual({
      ok: true,
      departmentId: 'dep-1',
    });
  });

  it('главе без отдела отказывает: сузить запрос не до чего', () => {
    expect(resolveDepartmentScope({ role: 'HEAD', departmentId: null })).toEqual({
      ok: false,
      status: 400,
      error: 'A department head must belong to a department',
    });
  });

  it('сотруднику отказывает', () => {
    expect(resolveDepartmentScope({ role: 'USER', departmentId: 'dep-1' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
  });

  it('неизвестной роли отказывает так же, как сотруднику', () => {
    expect(resolveDepartmentScope({ role: '', departmentId: 'dep-1' })).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
  });
});

function createDeps(overrides: Partial<DepartmentScopeDeps> = {}): DepartmentScopeDeps {
  return {
    getUserPolicy: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('resolveRequestDepartmentScope', () => {
  it('не читает политику для админ-уровневой роли', async () => {
    const deps = createDeps();

    const scope = await resolveRequestDepartmentScope(deps, SystemRoles.ADMIN, 'admin-1');

    expect(scope).toEqual({ ok: true, departmentId: null });
    expect(deps.getUserPolicy).not.toHaveBeenCalled();
  });

  it('не читает политику для сотрудника: отказ решён ролью, а не отделом', async () => {
    const deps = createDeps();

    const scope = await resolveRequestDepartmentScope(deps, SystemRoles.USER, 'user-1');

    expect(scope).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    expect(deps.getUserPolicy).not.toHaveBeenCalled();
  });

  it('читает политику главы ровно один раз и сужает область до его отдела', async () => {
    const deps = createDeps({
      getUserPolicy: jest.fn().mockResolvedValue({ departmentId: 'dep-1' }),
    });

    const scope = await resolveRequestDepartmentScope(deps, SystemRoles.HEAD, 'head-1');

    expect(scope).toEqual({ ok: true, departmentId: 'dep-1' });
    expect(deps.getUserPolicy).toHaveBeenCalledTimes(1);
    expect(deps.getUserPolicy).toHaveBeenCalledWith('head-1');
  });

  it('главе без отдела в политике отказывает', async () => {
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue({ departmentId: null }) });

    const scope = await resolveRequestDepartmentScope(deps, SystemRoles.HEAD, 'head-1');

    expect(scope).toEqual({
      ok: false,
      status: 400,
      error: 'A department head must belong to a department',
    });
  });

  it('главе без записи политики отказывает так же, как без отдела', async () => {
    const deps = createDeps({ getUserPolicy: jest.fn().mockResolvedValue(null) });

    const scope = await resolveRequestDepartmentScope(deps, SystemRoles.HEAD, 'head-1');

    expect(scope.ok).toBe(false);
  });
});
