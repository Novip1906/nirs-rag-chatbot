import { Types } from 'mongoose';
import { logger } from '@librechat/data-schemas';
import type { IDepartment, IUser, IUserPolicy } from '@librechat/data-schemas';
import type { DirectoryDepartment, DirectoryEmployee } from './client';
import type { DirectorySyncDeps } from './sync';
import {
  runDirectorySync,
  startDirectorySync,
  syncDirectoryDepartment,
  syncDirectoryEmployee,
} from './sync';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function employee(overrides: Partial<DirectoryEmployee> = {}): DirectoryEmployee {
  return {
    id: 'emp-1',
    sub: 'sub-1',
    email: 'ivan@example.com',
    first_name: 'Ivan',
    last_name: 'Ivanov',
    position: '',
    department_id: null,
    is_admin: false,
    blocked: false,
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function department(overrides: Partial<DirectoryDepartment> = {}): DirectoryDepartment {
  return {
    id: 'dep-1',
    name: 'Sales',
    description: '',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function mongoDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: new Types.ObjectId(),
    name: 'Sales',
    description: '',
    allowedModels: [],
    defaultLimits: { dailyCostUsd: null },
    ...overrides,
  } as IDepartment;
}

function mongoUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    name: 'Ivan Ivanov',
    email: 'ivan@example.com',
    role: 'USER',
    openidId: 'sub-1',
    employeeId: 'emp-1',
    position: '',
    ...overrides,
  } as IUser;
}

function policy(overrides: Partial<IUserPolicy> = {}): IUserPolicy {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    departmentId: null,
    blocked: false,
    ...overrides,
  } as IUserPolicy;
}

function assertUniqueDepartmentName(departments: IDepartment[], name: string, exceptId?: string) {
  if (departments.some((d) => d.name === name && d._id.toString() !== exceptId)) {
    throw Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { name: 1 },
    });
  }
}

interface World {
  employees?: DirectoryEmployee[];
  departments?: DirectoryDepartment[];
  users?: IUser[];
  mongoDepartments?: IDepartment[];
  policies?: Map<string, IUserPolicy>;
}

function makeDeps(world: World = {}, overrides: Partial<DirectorySyncDeps> = {}) {
  const state = {
    employees: world.employees ?? [],
    departments: world.departments ?? [],
    users: world.users ?? [],
    mongoDepartments: world.mongoDepartments ?? [],
    policies: world.policies ?? new Map<string, IUserPolicy>(),
    members: new Map<string, number>(),
  };
  const deps: DirectorySyncDeps = {
    client: {
      isConfigured: jest.fn().mockReturnValue(true),
      listEmployees: jest.fn().mockImplementation(async () => ({
        ok: true,
        value: state.employees,
      })),
      listDepartments: jest.fn().mockImplementation(async () => ({
        ok: true,
        value: state.departments,
      })),
      getEmployee: jest.fn().mockImplementation(async (id: string) => {
        const found = state.employees.find((candidate) => candidate.id === id);
        return found ? { ok: true, value: found } : { ok: false, reason: 'not_found' };
      }),
      getEmployeeBySub: jest.fn(),
    },
    issuer: 'http://sso/realms/corporate',
    runAsSystem: jest.fn().mockImplementation((fn: () => unknown) => fn()),
    listDepartments: jest.fn().mockImplementation(async () => state.mongoDepartments),
    createDepartment: jest.fn().mockImplementation(async (fields) => {
      assertUniqueDepartmentName(state.mongoDepartments, fields.name);
      const created = mongoDepartment({ ...fields });
      state.mongoDepartments.push(created);
      return created;
    }),
    updateDepartment: jest.fn().mockImplementation(async (id, fields) => {
      const found = state.mongoDepartments.find((d) => d._id.toString() === id);
      if (fields.name !== undefined) {
        assertUniqueDepartmentName(state.mongoDepartments, fields.name, id);
      }
      return found ? Object.assign(found, fields) : null;
    }),
    deleteDepartment: jest.fn().mockResolvedValue(true),
    countDepartmentMembers: jest.fn().mockImplementation(async (id: string) => {
      let count = 0;
      for (const p of state.policies.values()) {
        if (p.departmentId?.toString() === id) {
          count++;
        }
      }
      return count + (state.members.get(id) ?? 0);
    }),
    findUsers: jest.fn().mockImplementation(async (criteria: Record<string, unknown>) => {
      const or = criteria.$or as Array<Record<string, string>> | undefined;
      if (criteria._id) {
        return state.users.filter((u) => u._id.toString() === String(criteria._id));
      }
      if (!or) {
        return [...state.users];
      }
      return state.users.filter((u) =>
        or.some(
          (c) =>
            (c.employeeId && u.employeeId === c.employeeId) ||
            (c.openidId && u.openidId === c.openidId),
        ),
      );
    }),
    createUser: jest.fn().mockImplementation(async (data) => {
      const created = mongoUser({ ...data });
      state.users.push(created);
      return created;
    }),
    updateUser: jest.fn().mockImplementation(async (id, fields) => {
      const found = state.users.find((u) => u._id.toString() === id);
      return found ? Object.assign(found, fields) : null;
    }),
    listUserPolicies: jest.fn().mockImplementation(async (ids: string[]) => {
      const out = new Map<string, IUserPolicy>();
      ids.forEach((id) => {
        const p = state.policies.get(id);
        if (p) {
          out.set(id, p);
        }
      });
      return out;
    }),
    upsertUserPolicy: jest.fn().mockImplementation(async (id, fields) => {
      const current = state.policies.get(id) ?? policy();
      const next = { ...current, ...fields } as unknown as IUserPolicy;
      if (typeof fields.departmentId === 'string') {
        (next as { departmentId: unknown }).departmentId = new Types.ObjectId(fields.departmentId);
      }
      state.policies.set(id, next);
      return next;
    }),
    invalidateBlockedUser: jest.fn(),
    deleteAllUserSessions: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };
  return { deps, state };
}

function writes(deps: DirectorySyncDeps) {
  return [
    deps.createDepartment,
    deps.updateDepartment,
    deps.deleteDepartment,
    deps.createUser,
    deps.updateUser,
    deps.upsertUserPolicy,
    deps.invalidateBlockedUser,
    deps.deleteAllUserSessions,
  ] as jest.Mock[];
}

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('runDirectorySync departments', () => {
  it('links department by name on first run', async () => {
    const existing = mongoDepartment({ name: 'sales' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ name: 'Sales' })],
      mongoDepartments: [existing],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateDepartment).toHaveBeenCalledWith(existing._id.toString(), {
      directoryId: 'dep-1',
    });
    expect(deps.createDepartment).not.toHaveBeenCalled();
    expect(report.changes).toContainEqual({
      kind: 'department_linked',
      departmentId: existing._id.toString(),
      from: null,
      to: 'dep-1',
    });
  });

  it('creates missing department', async () => {
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ description: 'Продажи' })],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createDepartment).toHaveBeenCalledWith({
      name: 'Sales',
      description: 'Продажи',
      directoryId: 'dep-1',
    });
    expect(report.changes.map((c) => c.kind)).toContain('department_created');
  });

  it('updates name and description', async () => {
    const existing = mongoDepartment({ name: 'Old', description: 'a', directoryId: 'dep-1' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ name: 'New', description: 'b' })],
      mongoDepartments: [existing],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateDepartment).toHaveBeenCalledWith(existing._id.toString(), {
      name: 'New',
      description: 'b',
    });
    expect(report.changes).toContainEqual({
      kind: 'department_updated',
      departmentId: existing._id.toString(),
      from: 'Old',
      to: 'New',
    });
  });

  it('deletes removed empty department', async () => {
    const existing = mongoDepartment({ directoryId: 'dep-1' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ deleted_at: '2026-02-01T00:00:00Z' })],
      mongoDepartments: [existing],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.deleteDepartment).toHaveBeenCalledWith(existing._id.toString());
    expect(report.changes.map((c) => c.kind)).toContain('department_deleted');
  });

  it('reports department_in_use', async () => {
    const existing = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser({ employeeId: 'other', openidId: 'sub-other' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser(), user],
      departments: [department({ deleted_at: '2026-02-01T00:00:00Z' })],
      mongoDepartments: [existing],
      policies: new Map([[user._id.toString(), policy({ departmentId: existing._id })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.deleteDepartment).not.toHaveBeenCalled();
    expect(report.conflicts).toContainEqual({
      kind: 'department_in_use',
      departmentId: existing._id.toString(),
    });
  });

  it('deletes department whose members all leave in the same run', async () => {
    const existing = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ department_id: null })],
      users: [user],
      departments: [department({ deleted_at: '2026-02-01T00:00:00Z' })],
      mongoDepartments: [existing],
      policies: new Map([[user._id.toString(), policy({ departmentId: existing._id })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.deleteDepartment).toHaveBeenCalledWith(existing._id.toString());
    expect(report.conflicts).toEqual([]);
  });
});

describe('runDirectorySync employees', () => {
  it('creates user that never logged in', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const { deps } = makeDeps({
      employees: [employee({ position: 'Менеджер', department_id: 'dep-1' })],
      users: [mongoUser({ employeeId: 'x', openidId: 'sub-x' })],
      departments: [department()],
      mongoDepartments: [dep],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createUser).toHaveBeenCalledWith({
      provider: 'openid',
      openidId: 'sub-1',
      openidIssuer: 'http://sso/realms/corporate',
      email: 'ivan@example.com',
      username: 'ivan@example.com',
      name: 'Ivan Ivanov',
      employeeId: 'emp-1',
      emailVerified: true,
      role: 'USER',
      position: 'Менеджер',
    });
    const created = (deps.createUser as jest.Mock).mock.results[0];
    const createdUser = await created.value;
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(createdUser._id.toString(), {
      departmentId: dep._id.toString(),
    });
    expect(report.changes[0]).toMatchObject({ kind: 'user_created', to: 'emp-1' });
    expect(report.changes[0].userId).toBe(createdUser._id.toString());
  });

  it('links existing user by sub and adopts directory id', async () => {
    const user = mongoUser({ employeeId: 'random-uuid' });
    const { deps } = makeDeps({ employees: [employee()], users: [user] });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createUser).not.toHaveBeenCalled();
    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), { employeeId: 'emp-1' });
    expect(report.changes).toEqual([
      { kind: 'employee_id', userId: user._id.toString(), from: 'random-uuid', to: 'emp-1' },
    ]);
  });

  it('updates name email position', async () => {
    const user = mongoUser({ name: 'Old', email: 'old@example.com', position: 'a' });
    const { deps } = makeDeps({
      employees: [employee({ email: 'new@example.com', position: 'b' })],
      users: [user],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), {
      name: 'Ivan Ivanov',
      position: 'b',
    });
    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), {
      email: 'new@example.com',
    });
    expect(report.changes.map((c) => c.kind).sort()).toEqual(['email', 'name', 'position']);
  });

  it('reports email_taken and still applies other fields', async () => {
    const user = mongoUser({ name: 'Old', email: 'old@example.com' });
    const { deps } = makeDeps(
      { employees: [employee({ email: 'taken@example.com' })], users: [user] },
      {
        updateUser: jest.fn().mockImplementation(async (_id, fields) => {
          if ('email' in fields) {
            throw Object.assign(new Error('dup'), { code: 11000 });
          }
          return null;
        }),
      },
    );

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), { name: 'Ivan Ivanov' });
    expect(report.conflicts).toContainEqual({ kind: 'email_taken', userId: user._id.toString() });
  });

  it('reports email_taken when creating a user with a taken email', async () => {
    const { deps } = makeDeps(
      { employees: [employee()], users: [mongoUser({ employeeId: 'x', openidId: 'y' })] },
      {
        createUser: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
      },
    );

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toContainEqual({ kind: 'email_taken', employeeId: 'emp-1' });
    expect(report.applied).toBe(true);
  });

  it('sets department from directoryId', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ department_id: 'dep-1' })],
      users: [user],
      departments: [department()],
      mongoDepartments: [dep],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), {
      departmentId: dep._id.toString(),
    });
    expect(report.changes).toEqual([
      { kind: 'department', userId: user._id.toString(), from: null, to: dep._id.toString() },
    ]);
  });

  it('clears department', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ department_id: null })],
      users: [user],
      departments: [department()],
      mongoDepartments: [dep],
      policies: new Map([[user._id.toString(), policy({ departmentId: dep._id })]]),
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), {
      departmentId: null,
    });
  });

  it('blocks and wipes sessions', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({ employees: [employee({ blocked: true })], users: [user] });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), { blocked: true });
    expect(deps.invalidateBlockedUser).toHaveBeenCalledWith(user._id.toString());
    expect(deps.deleteAllUserSessions).toHaveBeenCalledWith(user._id.toString());
    expect(report.changes.map((c) => c.kind)).toEqual(['block']);
  });

  it('treats deleted as blocked', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ deleted_at: '2026-02-01T00:00:00Z' })],
      users: [user],
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), { blocked: true });
    expect(deps.deleteAllUserSessions).toHaveBeenCalledWith(user._id.toString());
  });

  it('unblocks without wiping sessions', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee()],
      users: [user],
      policies: new Map([[user._id.toString(), policy({ blocked: true })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), { blocked: false });
    expect(deps.invalidateBlockedUser).toHaveBeenCalledWith(user._id.toString());
    expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
    expect(report.changes.map((c) => c.kind)).toEqual(['unblock']);
  });

  it('promotes admin', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({ employees: [employee({ is_admin: true })], users: [user] });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), { role: 'ADMIN' });
    expect(report.changes).toEqual([
      { kind: 'role', userId: user._id.toString(), from: 'USER', to: 'ADMIN' },
    ]);
  });

  it('does not promote blocked admin', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ is_admin: true, blocked: true })],
      users: [user],
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('demotes former admin and owner to user', async () => {
    const admin = mongoUser({ role: 'ADMIN' });
    const owner = mongoUser({
      role: 'OWNER',
      employeeId: 'emp-2',
      openidId: 'sub-2',
      email: 'o@example.com',
    });
    const { deps } = makeDeps({
      employees: [employee(), employee({ id: 'emp-2', sub: 'sub-2', email: 'o@example.com' })],
      users: [admin, owner],
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(admin._id.toString(), { role: 'USER' });
    expect(deps.updateUser).toHaveBeenCalledWith(owner._id.toString(), { role: 'USER' });
  });

  it('turns owner with admin flag into admin', async () => {
    const owner = mongoUser({ role: 'OWNER' });
    const { deps } = makeDeps({ employees: [employee({ is_admin: true })], users: [owner] });

    await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(owner._id.toString(), { role: 'ADMIN' });
  });

  it('skips deleted employee unknown to mongo', async () => {
    const other = mongoUser({ employeeId: 'emp-2', openidId: 'sub-2', email: 'o@example.com' });
    const { deps } = makeDeps({
      employees: [
        employee({ deleted_at: '2026-02-01T00:00:00Z' }),
        employee({ id: 'emp-2', sub: 'sub-2', email: 'o@example.com' }),
      ],
      users: [other],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createUser).not.toHaveBeenCalled();
    expect(report.changes).toEqual([]);
  });

  it('frees email of deleted employee', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ deleted_at: '2026-02-01T00:00:00Z' })],
      users: [user],
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), {
      email: 'deleted-emp-1@deleted.invalid',
    });
  });

  it('new employee takes email freed in the same pass', async () => {
    const old = mongoUser();
    const emails = new Set<string>([old.email]);
    const { deps } = makeDeps(
      {
        employees: [
          employee({ id: 'emp-2', sub: 'sub-2' }),
          employee({ deleted_at: '2026-02-01T00:00:00Z' }),
        ],
        users: [old],
      },
      {
        updateUser: jest.fn().mockImplementation(async (id, fields) => {
          if (fields.email) {
            if (emails.has(fields.email)) {
              throw Object.assign(new Error('dup'), { code: 11000 });
            }
            emails.delete(old.email);
            emails.add(fields.email);
          }
          return null;
        }),
        createUser: jest.fn().mockImplementation(async (data) => {
          if (emails.has(data.email)) {
            throw Object.assign(new Error('dup'), { code: 11000 });
          }
          emails.add(data.email);
          return mongoUser({ ...data });
        }),
      },
    );

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toEqual([]);
    expect(deps.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ivan@example.com', employeeId: 'emp-2' }),
    );
  });

  it('demotes head when department changes', async () => {
    const oldDep = mongoDepartment({ directoryId: 'dep-0' });
    const newDep = mongoDepartment({ name: 'Ops', directoryId: 'dep-1' });
    const head = mongoUser({ role: 'HEAD' });
    const { deps } = makeDeps({
      employees: [employee({ department_id: 'dep-1' })],
      users: [head],
      departments: [department({ id: 'dep-0', name: 'Sales' }), department({ name: 'Ops' })],
      mongoDepartments: [oldDep, newDep],
      policies: new Map([[head._id.toString(), policy({ departmentId: oldDep._id })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(head._id.toString(), { role: 'USER' });
    expect(report.changes.map((c) => c.kind).sort()).toEqual(['department', 'role']);
  });

  it('demotes head that lost the department', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const head = mongoUser({ role: 'HEAD' });
    const { deps } = makeDeps({
      employees: [employee({ department_id: null })],
      users: [head],
      departments: [department()],
      mongoDepartments: [dep],
      policies: new Map([[head._id.toString(), policy({ departmentId: dep._id })]]),
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(head._id.toString(), { role: 'USER' });
  });

  it('keeps head when department unchanged', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const head = mongoUser({ role: 'HEAD' });
    const { deps } = makeDeps({
      employees: [employee({ department_id: 'dep-1' })],
      users: [head],
      departments: [department()],
      mongoDepartments: [dep],
      policies: new Map([[head._id.toString(), policy({ departmentId: dep._id })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.changes).toEqual([]);
    expect(deps.updateUser).not.toHaveBeenCalled();
  });

  it('reports missing_in_directory and changes nothing for that user', async () => {
    const stranger = mongoUser({ employeeId: 'zzz', openidId: 'sub-zzz', email: 'z@example.com' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser(), stranger],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toEqual([
      { kind: 'missing_in_directory', userId: stranger._id.toString() },
    ]);
    expect(report.changes).toEqual([]);
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('ignores local users without openidId when looking for missing', async () => {
    const local = mongoUser({ openidId: undefined, employeeId: 'local', email: 'l@example.com' });
    const { deps } = makeDeps({ employees: [employee()], users: [mongoUser(), local] });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toEqual([]);
  });
});

describe('runDirectorySync modes and safety', () => {
  it('report mode writes nothing', async () => {
    const dep = mongoDepartment({ name: 'sales' });
    const user = mongoUser({ name: 'Old', employeeId: 'random', role: 'ADMIN' });
    const { deps } = makeDeps({
      employees: [
        employee({ blocked: true, department_id: 'dep-1' }),
        employee({ id: 'emp-2', sub: 'sub-2', email: 'new@example.com', department_id: 'dep-2' }),
      ],
      users: [user],
      departments: [department(), department({ id: 'dep-2', name: 'Fresh' })],
      mongoDepartments: [dep],
    });

    const report = await runDirectorySync(deps, 'report');

    expect(report.applied).toBe(false);
    expect(report.changes.length).toBeGreaterThan(0);
    const kinds = report.changes.map((c) => c.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'department_linked',
        'department_created',
        'user_created',
        'employee_id',
        'name',
        'block',
        'department',
        'role',
      ]),
    );
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('aborts on empty directory', async () => {
    const { deps } = makeDeps({ employees: [], users: [mongoUser()] });

    const report = await runDirectorySync(deps, 'apply');

    expect(report).toEqual({
      changes: [],
      conflicts: [],
      applied: false,
      aborted: 'empty_directory',
    });
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('aborts on fetch error', async () => {
    const { deps } = makeDeps({ users: [mongoUser()] });
    (deps.client.listEmployees as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report).toEqual({
      changes: [],
      conflicts: [],
      applied: false,
      aborted: 'directory_error',
    });
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);

    (deps.client.listEmployees as jest.Mock).mockResolvedValue({ ok: true, value: [employee()] });
    (deps.client.listDepartments as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });
    const second = await runDirectorySync(deps, 'apply');
    expect(second.aborted).toBe('directory_error');
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('is idempotent', async () => {
    const dep = mongoDepartment({ name: 'sales' });
    const head = mongoUser({ role: 'HEAD', employeeId: 'random' });
    const { deps } = makeDeps({
      employees: [
        employee({ department_id: 'dep-1', is_admin: true, position: 'Boss' }),
        employee({ id: 'emp-2', sub: 'sub-2', email: 'n@example.com', blocked: true }),
      ],
      users: [head],
      departments: [department({ description: 'Продажи' })],
      mongoDepartments: [dep],
    });

    const first = await runDirectorySync(deps, 'apply');
    expect(first.changes.length).toBeGreaterThan(0);
    const second = await runDirectorySync(deps, 'apply');

    expect(second.changes).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });
});

describe('syncDirectoryEmployee', () => {
  it('applies one employee without full pass', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser({ employeeId: 'random', name: 'Old' });
    const { deps } = makeDeps({
      users: [user],
      mongoDepartments: [dep],
    });

    const result = await syncDirectoryEmployee(
      deps,
      employee({ department_id: 'dep-1', is_admin: true }),
    );

    expect(result).toEqual({ userId: user._id.toString() });
    expect(deps.client.listEmployees).not.toHaveBeenCalled();
    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), {
      name: 'Ivan Ivanov',
      employeeId: 'emp-1',
      role: 'ADMIN',
    });
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(user._id.toString(), {
      departmentId: dep._id.toString(),
    });
  });

  it('creates unknown employee and returns its id', async () => {
    const { deps } = makeDeps();

    const result = await syncDirectoryEmployee(deps, employee());

    expect(deps.createUser).toHaveBeenCalled();
    const created = await (deps.createUser as jest.Mock).mock.results[0].value;
    expect(result).toEqual({ userId: created._id.toString() });
  });

  it('continues with the existing user when a concurrent call created it first', async () => {
    const { deps, state } = makeDeps();
    let creates = 0;
    (deps.createUser as jest.Mock).mockImplementation(async (data) => {
      creates += 1;
      if (creates > 1) {
        throw Object.assign(new Error('E11000 duplicate key'), {
          code: 11000,
          keyPattern: { employeeId: 1 },
        });
      }
      const created = mongoUser({ ...data });
      state.users.push(created);
      return created;
    });

    const [first, second] = await Promise.all([
      syncDirectoryEmployee(deps, employee()),
      syncDirectoryEmployee(deps, employee()),
    ]);

    expect(state.users).toHaveLength(1);
    expect(first.userId).toBe(state.users[0]._id.toString());
    expect(second.userId).toBe(state.users[0]._id.toString());
  });

  it('leaves department untouched when it is not known locally yet', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const user = mongoUser();
    const { deps } = makeDeps({
      users: [user],
      mongoDepartments: [dep],
      policies: new Map([[user._id.toString(), policy({ departmentId: dep._id })]]),
    });

    await syncDirectoryEmployee(deps, employee({ department_id: 'dep-unknown' }));

    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });
});

describe('syncDirectoryDepartment', () => {
  it('creates, updates and deletes one department', async () => {
    const { deps, state } = makeDeps();

    await syncDirectoryDepartment(deps, department({ description: 'x' }));
    expect(deps.createDepartment).toHaveBeenCalledWith({
      name: 'Sales',
      description: 'x',
      directoryId: 'dep-1',
    });

    await syncDirectoryDepartment(deps, department({ name: 'Renamed' }));
    expect(deps.updateDepartment).toHaveBeenCalled();
    expect(state.mongoDepartments[0].name).toBe('Renamed');

    await syncDirectoryDepartment(deps, department({ deleted_at: '2026-02-01T00:00:00Z' }));
    expect(deps.deleteDepartment).toHaveBeenCalledWith(state.mongoDepartments[0]._id.toString());
  });

  it('keeps a used department when deleted in the directory', async () => {
    const dep = mongoDepartment({ directoryId: 'dep-1' });
    const { deps, state } = makeDeps({ mongoDepartments: [dep] });
    state.members.set(dep._id.toString(), 2);

    await syncDirectoryDepartment(deps, department({ deleted_at: '2026-02-01T00:00:00Z' }));

    expect(deps.deleteDepartment).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[directorySync] conflict: department_in_use',
      expect.anything(),
    );
  });

  it('does not relink foreign departments when the directory list cannot be read', async () => {
    const foreign = mongoDepartment({ name: 'sales', directoryId: 'dep-other' });
    const free = mongoDepartment({ name: 'Support' });
    const { deps } = makeDeps({ mongoDepartments: [foreign, free] });
    (deps.client.listDepartments as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });

    await syncDirectoryDepartment(deps, department());
    await syncDirectoryDepartment(deps, department({ id: 'dep-2', name: 'support' }));

    expect(deps.updateDepartment).not.toHaveBeenCalledWith(foreign._id.toString(), {
      directoryId: 'dep-1',
    });
    expect(foreign.directoryId).toBe('dep-other');
    expect(deps.updateDepartment).toHaveBeenCalledWith(free._id.toString(), {
      directoryId: 'dep-2',
    });
  });
});

describe('startDirectorySync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not start when mode is off or unset', () => {
    const { deps } = makeDeps();
    delete process.env.ADMIN_API_SYNC_MODE;
    startDirectorySync(deps);
    process.env.ADMIN_API_SYNC_MODE = 'off';
    startDirectorySync(deps);
    jest.advanceTimersByTime(600000);
    expect(deps.client.listEmployees).not.toHaveBeenCalled();
  });

  it('does not start when the client is not configured', () => {
    const { deps } = makeDeps();
    (deps.client.isConfigured as jest.Mock).mockReturnValue(false);
    process.env.ADMIN_API_SYNC_MODE = 'apply';
    startDirectorySync(deps);
    jest.advanceTimersByTime(600000);
    expect(deps.client.listEmployees).not.toHaveBeenCalled();
  });

  it('runs on the configured interval and does not overlap', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps } = makeDeps();
    (deps.client.listEmployees as jest.Mock).mockImplementation(async () => {
      await gate;
      return { ok: true, value: [] };
    });
    process.env.ADMIN_API_SYNC_MODE = 'report';
    process.env.ADMIN_API_SYNC_INTERVAL_MS = '10000';

    const stop = startDirectorySync(deps);
    await jest.advanceTimersByTimeAsync(30000);
    await jest.advanceTimersByTimeAsync(30000);
    expect(deps.client.listEmployees).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(10000);
    expect(deps.client.listEmployees).toHaveBeenCalledTimes(2);
    stop();
  });

  it('falls back to default interval on an invalid value', () => {
    const { deps } = makeDeps();
    process.env.ADMIN_API_SYNC_MODE = 'report';
    process.env.ADMIN_API_SYNC_INTERVAL_MS = '5';
    const stop = startDirectorySync(deps);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid ADMIN_API_SYNC_INTERVAL_MS'),
      expect.anything(),
    );
    stop();
  });
});

function duplicateError(keyPattern?: Record<string, number>) {
  return Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern });
}

describe('runDirectorySync department matching', () => {
  it('relinks department recreated with the same name', async () => {
    const old = mongoDepartment({
      name: 'Продажи',
      directoryId: 'dep-old',
      allowedModels: ['model-a'],
    });
    const user = mongoUser();
    const { deps } = makeDeps({
      employees: [employee({ department_id: 'dep-new' })],
      users: [user],
      departments: [
        department({ id: 'dep-old', name: 'Продажи', deleted_at: '2026-02-01T00:00:00Z' }),
        department({ id: 'dep-new', name: 'Продажи' }),
      ],
      mongoDepartments: [old],
      policies: new Map([[user._id.toString(), policy({ departmentId: old._id })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createDepartment).not.toHaveBeenCalled();
    expect(deps.deleteDepartment).not.toHaveBeenCalled();
    expect(old.directoryId).toBe('dep-new');
    expect(old.allowedModels).toEqual(['model-a']);
    expect(report.changes).toContainEqual({
      kind: 'department_linked',
      departmentId: old._id.toString(),
      from: 'dep-old',
      to: 'dep-new',
    });
    expect(report.conflicts).toEqual([]);
    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
  });

  it('relinks a department whose directory id is absent from the response', async () => {
    const old = mongoDepartment({ name: 'Support', directoryId: 'dep-vanished' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ id: 'dep-new', name: 'support' })],
      mongoDepartments: [old],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(old.directoryId).toBe('dep-new');
    expect(deps.createDepartment).not.toHaveBeenCalled();
    expect(report.conflicts).toEqual([]);
  });

  it('handles two departments swapping names', async () => {
    const alpha = mongoDepartment({ name: 'Alpha', directoryId: 'dep-a' });
    const beta = mongoDepartment({ name: 'Beta', directoryId: 'dep-b' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [
        department({ id: 'dep-a', name: 'Beta' }),
        department({ id: 'dep-b', name: 'Alpha' }),
      ],
      mongoDepartments: [alpha, beta],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(alpha.name).toBe('Beta');
    expect(beta.name).toBe('Alpha');
    expect(deps.createDepartment).not.toHaveBeenCalled();
    expect(deps.deleteDepartment).not.toHaveBeenCalled();
    expect(report.conflicts).toEqual([]);
  });

  it('links department by name ignoring case and repeated spaces', async () => {
    const existing = mongoDepartment({ name: 'Отдел  Продаж' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      departments: [department({ name: ' отдел продаж ' })],
      mongoDepartments: [existing],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.createDepartment).not.toHaveBeenCalled();
    expect(report.changes).toContainEqual({
      kind: 'department_linked',
      departmentId: existing._id.toString(),
      from: null,
      to: 'dep-1',
    });
  });

  it('reports department_missing_in_directory and changes nothing', async () => {
    const orphan = mongoDepartment({ name: 'Gone', directoryId: 'dep-gone' });
    const { deps } = makeDeps({
      employees: [employee()],
      users: [mongoUser()],
      mongoDepartments: [orphan],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toContainEqual({
      kind: 'department_missing_in_directory',
      departmentId: orphan._id.toString(),
    });
    expect(deps.updateDepartment).not.toHaveBeenCalled();
    expect(deps.deleteDepartment).not.toHaveBeenCalled();
  });
});

describe('runDirectorySync stale snapshot protection', () => {
  it('full pass does not re-block user unblocked by notification', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({ employees: [employee({ blocked: true })], users: [user] });
    (deps.client.getEmployee as jest.Mock).mockResolvedValue({
      ok: true,
      value: employee({ blocked: false }),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
    expect(report.changes.map((c) => c.kind)).not.toContain('block');
  });

  it('does not block a user that is already blocked when re-read', async () => {
    const user = mongoUser();
    const { deps, state } = makeDeps({ employees: [employee({ blocked: true })], users: [user] });
    (deps.client.getEmployee as jest.Mock).mockImplementation(async () => {
      state.policies.set(user._id.toString(), policy({ blocked: true }));
      return { ok: true, value: employee({ blocked: true }) };
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('skips a dangerous change when the employee cannot be re-read', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({ employees: [employee({ blocked: true })], users: [user] });
    (deps.client.getEmployee as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });

    await runDirectorySync(deps, 'apply');

    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('does not apply one change from the full pass and a notification at the same time', async () => {
    const user = mongoUser();
    const { deps } = makeDeps({ employees: [employee({ blocked: true })], users: [user] });
    const original = (deps.upsertUserPolicy as jest.Mock).getMockImplementation() as (
      ...args: unknown[]
    ) => Promise<unknown>;
    (deps.upsertUserPolicy as jest.Mock).mockImplementation(async (...args: unknown[]) => {
      await new Promise((resolve) => setImmediate(resolve));
      return original(...args);
    });

    await Promise.all([
      runDirectorySync(deps, 'apply'),
      syncDirectoryEmployee(deps, employee({ blocked: true })),
    ]);

    expect(deps.upsertUserPolicy).toHaveBeenCalledTimes(1);
    expect(deps.deleteAllUserSessions).toHaveBeenCalledTimes(1);
  });

  it('adopts a user created concurrently instead of reporting a conflict', async () => {
    const { deps, state } = makeDeps({ employees: [employee()] });
    (deps.createUser as jest.Mock).mockImplementation(async () => {
      state.users.push(mongoUser());
      throw duplicateError({ employeeId: 1 });
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toEqual([]);
    expect(deps.createUser).toHaveBeenCalledTimes(1);
  });

  it('duplicate on create replans with fresh employee record', async () => {
    const { deps, state } = makeDeps({ employees: [employee({ blocked: false })] });
    (deps.createUser as jest.Mock).mockImplementation(async () => {
      const existing = mongoUser();
      state.users.push(existing);
      state.policies.set(existing._id.toString(), policy({ blocked: true }));
      throw duplicateError({ employeeId: 1 });
    });
    (deps.client.getEmployee as jest.Mock).mockResolvedValue({
      ok: true,
      value: employee({ blocked: true }),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.upsertUserPolicy).not.toHaveBeenCalled();
    expect(deps.invalidateBlockedUser).not.toHaveBeenCalled();
    expect(report.changes.map((c) => c.kind)).not.toContain('unblock');
  });

  it('skips a sub change when the employee cannot be re-read', async () => {
    const user = mongoUser({ openidId: 'old-sub' });
    const { deps } = makeDeps({ employees: [employee({ sub: 'sub-new' })], users: [user] });
    (deps.client.getEmployee as jest.Mock).mockResolvedValue({
      ok: false,
      reason: 'unavailable',
    });

    await runDirectorySync(deps, 'apply');

    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(user.openidId).toBe('old-sub');
  });

  it('applies a sub change from the re-read employee record', async () => {
    const user = mongoUser({ openidId: 'old-sub' });
    const { deps } = makeDeps({ employees: [employee({ sub: 'sub-new' })], users: [user] });
    (deps.client.getEmployee as jest.Mock).mockResolvedValue({
      ok: true,
      value: employee({ sub: 'sub-newer' }),
    });

    await runDirectorySync(deps, 'apply');

    expect(deps.client.getEmployee).toHaveBeenCalledTimes(1);
    expect(user.openidId).toBe('sub-newer');
  });
});

describe('runDirectorySync conflicts', () => {
  it.each([
    [{ employeeId: 1 }, 'employee_id_taken'],
    [{ openidId: 1, tenantId: 1 }, 'sub_taken'],
    [{ email: 1, tenantId: 1 }, 'email_taken'],
  ])('classifies a duplicate on %j as %s', async (keyPattern, kind) => {
    const { deps } = makeDeps({ employees: [employee()] });
    (deps.createUser as jest.Mock).mockRejectedValue(duplicateError(keyPattern));

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toContainEqual({ kind, employeeId: 'emp-1' });
  });

  it('logs one conflict per employee', async () => {
    const { deps } = makeDeps({
      employees: [
        employee({ id: 'emp-77', sub: 'sub-77', email: 'a77@example.com' }),
        employee({ id: 'emp-78', sub: 'sub-78', email: 'a78@example.com' }),
      ],
    });
    (deps.createUser as jest.Mock).mockRejectedValue(duplicateError({ email: 1 }));
    (logger.warn as jest.Mock).mockClear();

    await runDirectorySync(deps, 'apply');

    const logged = (logger.warn as jest.Mock).mock.calls.filter(
      ([message]) => message === '[directorySync] conflict: email_taken',
    );
    expect(logged).toHaveLength(2);
  });

  it('report mode predicts email conflicts from the snapshot', async () => {
    const holder = mongoUser({
      email: 'taken@example.com',
      employeeId: undefined,
      openidId: undefined,
    });
    const existing = mongoUser({ email: 'old@example.com' });
    const { deps } = makeDeps({
      employees: [
        employee({ email: 'Taken@Example.com' }),
        employee({ id: 'emp-2', sub: 'sub-2', email: 'twin@example.com' }),
        employee({ id: 'emp-3', sub: 'sub-3', email: 'TWIN@example.com' }),
      ],
      users: [existing, holder],
    });

    const report = await runDirectorySync(deps, 'report');

    expect(report.conflicts).toContainEqual({
      kind: 'email_taken',
      userId: existing._id.toString(),
    });
    expect(report.conflicts).toContainEqual({ kind: 'email_taken', employeeId: 'emp-2' });
    expect(report.conflicts).toContainEqual({ kind: 'email_taken', employeeId: 'emp-3' });
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('reports sub_mismatch and changes neither user when another user holds the sub', async () => {
    const stale = mongoUser({ employeeId: 'emp-1', openidId: 'old-sub', email: 'a@example.com' });
    const current = mongoUser({ employeeId: 'random', openidId: 'sub-1', email: 'b@example.com' });
    const { deps } = makeDeps({
      employees: [employee({ blocked: true })],
      users: [stale, current],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.conflicts).toEqual([
      { kind: 'sub_mismatch', userId: stale._id.toString(), employeeId: 'emp-1' },
    ]);
    expect(report.changes).toEqual([]);
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('point sync also refuses on sub_mismatch', async () => {
    const stale = mongoUser({ employeeId: 'emp-1', openidId: 'old-sub', email: 'a@example.com' });
    const current = mongoUser({ employeeId: 'random', openidId: 'sub-1', email: 'b@example.com' });
    const { deps } = makeDeps({ users: [stale, current] });

    const result = await syncDirectoryEmployee(deps, employee({ blocked: true }));

    expect(result).toEqual({ userId: null });
    expect(writes(deps).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('updates openidId when the user found by employeeId has another sub', async () => {
    const user = mongoUser({ employeeId: 'emp-1', openidId: 'old-sub' });
    const { deps } = makeDeps({ employees: [employee()], users: [user] });

    const report = await runDirectorySync(deps, 'apply');

    expect(deps.updateUser).toHaveBeenCalledWith(user._id.toString(), { openidId: 'sub-1' });
    expect(report.changes).toContainEqual({
      kind: 'sub',
      userId: user._id.toString(),
      from: 'old-sub',
      to: 'sub-1',
    });
    expect(report.conflicts).toEqual([]);
  });
});

describe('runDirectorySync dangerous change limit', () => {
  function crowd(count: number, blockedFlag = true) {
    const employees: DirectoryEmployee[] = [];
    const users: IUser[] = [];
    for (let i = 0; i < count; i++) {
      employees.push(
        employee({
          id: `emp-${i + 10}`,
          sub: `sub-${i + 10}`,
          email: `u${i}@example.com`,
          blocked: blockedFlag,
        }),
      );
      users.push(
        mongoUser({
          employeeId: `emp-${i + 10}`,
          openidId: `sub-${i + 10}`,
          email: `u${i}@example.com`,
        }),
      );
    }
    return { employees, users };
  }

  it('applies nothing dangerous when there are too many blocks', async () => {
    const { employees, users } = crowd(6);
    const renamed = mongoUser({ name: 'Old', employeeId: 'emp-1', openidId: 'sub-1' });
    const unblocked = mongoUser({
      employeeId: 'emp-2',
      openidId: 'sub-2',
      email: 'two@example.com',
    });
    const { deps } = makeDeps({
      employees: [
        ...employees,
        employee(),
        employee({ id: 'emp-2', sub: 'sub-2', email: 'two@example.com' }),
      ],
      users: [...users, renamed, unblocked],
      policies: new Map([[unblocked._id.toString(), policy({ blocked: true })]]),
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.aborted).toBe('too_many_changes');
    expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
    expect(deps.upsertUserPolicy).not.toHaveBeenCalledWith(expect.anything(), { blocked: true });
    expect(deps.updateUser).toHaveBeenCalledWith(renamed._id.toString(), {
      name: 'Ivan Ivanov',
    });
    expect(deps.upsertUserPolicy).toHaveBeenCalledWith(unblocked._id.toString(), {
      blocked: false,
    });
    expect(report.changes.map((c) => c.kind)).not.toContain('block');
  });

  it('counts demotions from ADMIN together with blocks', async () => {
    const { employees, users } = crowd(3);
    const admins: IUser[] = [];
    const adminEmployees: DirectoryEmployee[] = [];
    for (let i = 0; i < 3; i++) {
      admins.push(
        mongoUser({
          role: 'ADMIN',
          employeeId: `adm-${i}`,
          openidId: `adm-sub-${i}`,
          email: `adm${i}@example.com`,
        }),
      );
      adminEmployees.push(
        employee({ id: `adm-${i}`, sub: `adm-sub-${i}`, email: `adm${i}@example.com` }),
      );
    }
    const { deps } = makeDeps({
      employees: [...employees, ...adminEmployees],
      users: [...users, ...admins],
    });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.aborted).toBe('too_many_changes');
    expect(admins.every((admin) => admin.role === 'ADMIN')).toBe(true);
    expect(deps.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('honours ADMIN_API_SYNC_MAX_CHANGES', async () => {
    const { employees, users } = crowd(6);
    const { deps } = makeDeps({ employees, users });
    process.env.ADMIN_API_SYNC_MAX_CHANGES = '6';

    const report = await runDirectorySync(deps, 'apply');

    expect(report.aborted).toBeUndefined();
    expect(deps.deleteAllUserSessions).toHaveBeenCalledTimes(6);
  });

  it('too_many_changes keeps emails of deleted employees', async () => {
    const { employees, users } = crowd(6, false);
    const deletedEmployees = employees.map((e) => ({
      ...e,
      deleted_at: '2026-02-01T00:00:00Z',
    }));
    const { deps } = makeDeps({ employees: deletedEmployees, users });

    const report = await runDirectorySync(deps, 'apply');

    expect(report.aborted).toBe('too_many_changes');
    expect(deps.updateUser).not.toHaveBeenCalled();
    expect(users.every((user) => !user.email.endsWith('@deleted.invalid'))).toBe(true);
    expect(report.changes.map((c) => c.kind)).not.toContain('email');
  });

  it('logs the too_many_changes abort once for an unchanged set', async () => {
    const { employees, users } = crowd(7);
    const { deps } = makeDeps({ employees, users });
    (logger.error as jest.Mock).mockClear();

    await runDirectorySync(deps, 'apply');
    await runDirectorySync(deps, 'apply');

    const aborts = (logger.error as jest.Mock).mock.calls.filter(([message]) =>
      String(message).includes('too many dangerous changes'),
    );
    expect(aborts).toHaveLength(1);
  });

  it('does not limit point sync', async () => {
    const { employees, users } = crowd(1);
    const { deps } = makeDeps({ users });
    process.env.ADMIN_API_SYNC_MAX_CHANGES = '0';

    await syncDirectoryEmployee(deps, employees[0]);

    expect(deps.deleteAllUserSessions).toHaveBeenCalledTimes(1);
  });
});
