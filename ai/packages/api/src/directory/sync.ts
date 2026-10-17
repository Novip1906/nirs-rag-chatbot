import { logger } from '@librechat/data-schemas';
import { SystemRoles } from 'librechat-data-provider';
import type { FilterQuery } from 'mongoose';
import type { IDepartment, IUser, IUserPolicy } from '@librechat/data-schemas';
import type { DirectoryClient, DirectoryDepartment, DirectoryEmployee } from './client';
import { composeFullName } from './composeFullName';

export type DirectorySyncMode = 'off' | 'report' | 'apply';

export interface DirectorySyncChange {
  kind:
    | 'user_created'
    | 'name'
    | 'email'
    | 'position'
    | 'employee_id'
    | 'sub'
    | 'block'
    | 'unblock'
    | 'department'
    | 'role'
    | 'department_created'
    | 'department_updated'
    | 'department_deleted'
    | 'department_linked';
  userId?: string;
  departmentId?: string;
  from: string | null;
  to: string | null;
}

export interface DirectorySyncConflict {
  kind:
    | 'email_taken'
    | 'employee_id_taken'
    | 'sub_taken'
    | 'sub_mismatch'
    | 'missing_in_directory'
    | 'department_in_use'
    | 'department_missing_in_directory';
  userId?: string;
  employeeId?: string;
  departmentId?: string;
}

export interface DirectorySyncReport {
  changes: DirectorySyncChange[];
  conflicts: DirectorySyncConflict[];
  applied: boolean;
  aborted?: 'directory_error' | 'empty_directory' | 'too_many_changes';
  heldBack?: number;
}

interface UpsertUserPolicyFields {
  departmentId?: string | null;
  blocked?: boolean;
}

export interface DirectorySyncDeps {
  client: DirectoryClient;
  issuer: string;
  runAsSystem: <T>(fn: () => Promise<T>) => Promise<T>;
  listDepartments: () => Promise<IDepartment[]>;
  createDepartment: (fields: {
    name: string;
    description?: string;
    directoryId: string;
  }) => Promise<IDepartment>;
  updateDepartment: (
    id: string,
    fields: Partial<Pick<IDepartment, 'name' | 'description' | 'directoryId'>>,
  ) => Promise<IDepartment | null>;
  deleteDepartment: (id: string) => Promise<unknown>;
  countDepartmentMembers: (id: string) => Promise<number>;
  findUsers: (criteria: FilterQuery<IUser>, fields?: string | string[] | null) => Promise<IUser[]>;
  createUser: (data: Partial<IUser>) => Promise<IUser>;
  updateUser: (userId: string, fields: Partial<IUser>) => Promise<IUser | null>;
  listUserPolicies: (userIds: string[]) => Promise<Map<string, IUserPolicy>>;
  upsertUserPolicy: (userId: string, fields: UpsertUserPolicyFields) => Promise<IUserPolicy>;
  invalidateBlockedUser: (userId: string) => void;
  deleteAllUserSessions: (userId: string) => Promise<{ deletedCount?: number }>;
}

export type DepartmentLookup = Map<string, IDepartment | null>;

export interface EmployeePlan {
  changes: DirectorySyncChange[];
  userFields: Partial<IUser>;
  emailTo?: string;
  policyFields: UpsertUserPolicyFields;
  blockTransition: 'block' | 'unblock' | null;
  createData?: Partial<IUser>;
}

const USER_FIELDS = '_id name email role openidId employeeId position';

const loggedKeys = new Set<string>();

function changeKey(change: DirectorySyncChange): string {
  return `change:${change.kind}:${change.userId ?? ''}:${change.departmentId ?? ''}:${change.from ?? ''}:${change.to ?? ''}`;
}

function conflictKey(conflict: DirectorySyncConflict): string {
  return `conflict:${conflict.kind}:${conflict.userId ?? ''}:${conflict.employeeId ?? ''}:${conflict.departmentId ?? ''}`;
}

function logChangeOnce(change: DirectorySyncChange, activeKeys: Set<string>): void {
  const key = changeKey(change);
  activeKeys.add(key);
  if (loggedKeys.has(key)) {
    return;
  }
  loggedKeys.add(key);
  logger.info(`[directorySync] change: ${change.kind}`, {
    userId: change.userId,
    departmentId: change.departmentId,
    from: change.from,
    to: change.to,
  });
}

function logConflictOnce(conflict: DirectorySyncConflict, activeKeys: Set<string>): void {
  const key = conflictKey(conflict);
  activeKeys.add(key);
  if (loggedKeys.has(key)) {
    return;
  }
  loggedKeys.add(key);
  logger.warn(`[directorySync] conflict: ${conflict.kind}`, {
    userId: conflict.userId,
    employeeId: conflict.employeeId,
    departmentId: conflict.departmentId,
  });
}

function logAbortOnce(employeeIds: string[], limit: number, activeKeys: Set<string>): void {
  const key = `abort:too_many_changes:${[...employeeIds].sort().join(',')}`;
  activeKeys.add(key);
  if (loggedKeys.has(key)) {
    return;
  }
  loggedKeys.add(key);
  logger.error('[directorySync] too many dangerous changes, none of them is applied', {
    count: employeeIds.length,
    limit,
    employeeIds,
  });
}

function pruneStaleKeys(activeKeys: Set<string>): void {
  for (const key of Array.from(loggedKeys)) {
    if (!activeKeys.has(key)) {
      loggedKeys.delete(key);
    }
  }
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

const MIN_SYNC_INTERVAL_MS = 10000;
const DEFAULT_SYNC_INTERVAL_MS = 60000;

function resolveConfiguredIntervalMs(): number {
  const raw = process.env.ADMIN_API_SYNC_INTERVAL_MS;
  if (raw === undefined) {
    return DEFAULT_SYNC_INTERVAL_MS;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= MIN_SYNC_INTERVAL_MS) {
    return parsed;
  }
  logger.warn('[directorySync] Invalid ADMIN_API_SYNC_INTERVAL_MS, defaulting to 60000', {
    value: raw,
  });
  return DEFAULT_SYNC_INTERVAL_MS;
}

function isAdminLevel(role: string | undefined): boolean {
  return role === SystemRoles.ADMIN || role === SystemRoles.OWNER;
}

export function planEmployee(
  employee: DirectoryEmployee,
  user: IUser | undefined,
  policy: IUserPolicy | undefined,
  departmentsByDirectoryId: DepartmentLookup,
  issuer = '',
): EmployeePlan {
  const userId = user?._id.toString();
  const changes: DirectorySyncChange[] = [];
  const userFields: Partial<IUser> = {};
  const policyFields: UpsertUserPolicyFields = {};
  let emailTo: string | undefined;
  let blockTransition: 'block' | 'unblock' | null = null;

  const deleted = employee.deleted_at != null;
  const effectiveBlocked = employee.blocked || deleted;
  if (!user && deleted) {
    return { changes, userFields, policyFields, blockTransition };
  }
  const name = composeFullName(employee.first_name, employee.last_name, '');
  const position = employee.position ?? '';

  let targetDepartmentId: string | null | undefined;
  let departmentTarget: IDepartment | null | undefined;
  if (employee.department_id == null) {
    targetDepartmentId = null;
    departmentTarget = null;
  } else if (departmentsByDirectoryId.has(employee.department_id)) {
    departmentTarget = departmentsByDirectoryId.get(employee.department_id) ?? null;
    targetDepartmentId = departmentTarget ? departmentTarget._id.toString() : null;
  }
  const currentDepartmentId = policy?.departmentId?.toString() ?? null;
  const departmentKnown = targetDepartmentId !== undefined;
  const departmentChanged = departmentKnown && targetDepartmentId !== currentDepartmentId;

  let role: string | undefined = user?.role ?? SystemRoles.USER;
  if (employee.is_admin && !effectiveBlocked) {
    role = SystemRoles.ADMIN;
  } else if (!employee.is_admin && isAdminLevel(role)) {
    role = SystemRoles.USER;
  } else if (role === SystemRoles.HEAD && departmentChanged) {
    role = SystemRoles.USER;
  }

  if (!user) {
    const createData: Partial<IUser> = {
      provider: 'openid',
      openidId: employee.sub,
      openidIssuer: issuer,
      email: employee.email,
      username: employee.email,
      name: name !== '' ? name : employee.email,
      employeeId: employee.id,
      emailVerified: true,
      role,
      position,
    };
    changes.push({ kind: 'user_created', from: null, to: employee.id });
    if (departmentKnown && targetDepartmentId != null) {
      policyFields.departmentId = targetDepartmentId;
      changes.push({ kind: 'department', from: null, to: targetDepartmentId });
    }
    if (effectiveBlocked) {
      policyFields.blocked = true;
      blockTransition = 'block';
      changes.push({ kind: 'block', from: 'false', to: 'true' });
    }
    return { changes, userFields, policyFields, blockTransition, createData };
  }

  if (name !== '' && name !== user.name) {
    userFields.name = name;
    changes.push({ kind: 'name', userId, from: user.name ?? null, to: name });
  }
  const targetEmail = deleted ? `deleted-${employee.id}@deleted.invalid` : employee.email;
  if (targetEmail !== '' && targetEmail.toLowerCase() !== user.email.toLowerCase()) {
    emailTo = targetEmail;
    changes.push({ kind: 'email', userId, from: user.email, to: targetEmail });
  }
  if (user.employeeId !== employee.id) {
    userFields.employeeId = employee.id;
    changes.push({ kind: 'employee_id', userId, from: user.employeeId ?? null, to: employee.id });
  }
  if (user.openidId !== employee.sub) {
    userFields.openidId = employee.sub;
    changes.push({ kind: 'sub', userId, from: user.openidId ?? null, to: employee.sub });
  }
  if ((user.position ?? '') !== position) {
    userFields.position = position;
    changes.push({ kind: 'position', userId, from: user.position ?? null, to: position });
  }

  const wasBlocked = policy?.blocked === true;
  if (effectiveBlocked && !wasBlocked) {
    policyFields.blocked = true;
    blockTransition = 'block';
    changes.push({ kind: 'block', userId, from: 'false', to: 'true' });
  } else if (!effectiveBlocked && wasBlocked) {
    policyFields.blocked = false;
    blockTransition = 'unblock';
    changes.push({ kind: 'unblock', userId, from: 'true', to: 'false' });
  }

  if (departmentChanged) {
    policyFields.departmentId = targetDepartmentId as string | null;
    changes.push({
      kind: 'department',
      userId,
      from: currentDepartmentId,
      to: targetDepartmentId as string | null,
    });
  }

  if (role !== user.role) {
    userFields.role = role;
    changes.push({ kind: 'role', userId, from: user.role ?? null, to: role ?? null });
  }

  return { changes, userFields, emailTo, policyFields, blockTransition };
}

const DEFAULT_MAX_DANGEROUS_CHANGES = 5;

function resolveMaxDangerousChanges(): number {
  const raw = process.env.ADMIN_API_SYNC_MAX_CHANGES;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_DANGEROUS_CHANGES;
  }
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  logger.warn('[directorySync] Invalid ADMIN_API_SYNC_MAX_CHANGES, defaulting to 5', {
    value: raw,
  });
  return DEFAULT_MAX_DANGEROUS_CHANGES;
}

const employeeLocks = new Map<string, Promise<void>>();

async function withEmployeeLock<T>(employeeId: string, fn: () => Promise<T>): Promise<T> {
  const previous = employeeLocks.get(employeeId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  employeeLocks.set(employeeId, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (employeeLocks.get(employeeId) === tail) {
      employeeLocks.delete(employeeId);
    }
  }
}

function classifyDuplicate(error: unknown): DirectorySyncConflict['kind'] {
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
  if ('employeeId' in keyPattern) {
    return 'employee_id_taken';
  }
  if ('openidId' in keyPattern) {
    return 'sub_taken';
  }
  return 'email_taken';
}

interface ResolvedUser {
  user?: IUser;
  mismatch?: IUser;
}

function resolveUser(
  employee: DirectoryEmployee,
  byEmployeeId: IUser | undefined,
  bySub: IUser | undefined,
): ResolvedUser {
  if (byEmployeeId) {
    if (
      byEmployeeId.openidId !== employee.sub &&
      bySub &&
      bySub._id.toString() !== byEmployeeId._id.toString()
    ) {
      return { user: byEmployeeId, mismatch: bySub };
    }
    return { user: byEmployeeId };
  }
  return { user: bySub };
}

async function readCurrent(
  deps: DirectorySyncDeps,
  employee: DirectoryEmployee,
): Promise<ResolvedUser & { policy?: IUserPolicy }> {
  const candidates = await deps.findUsers(
    { $or: [{ employeeId: employee.id }, { openidId: employee.sub }] },
    USER_FIELDS,
  );
  const resolved = resolveUser(
    employee,
    candidates.find((candidate) => candidate.employeeId === employee.id),
    candidates.find((candidate) => candidate.openidId === employee.sub),
  );
  if (!resolved.user) {
    return resolved;
  }
  const userId = resolved.user._id.toString();
  const policies = await deps.listUserPolicies([userId]);
  return { ...resolved, policy: policies.get(userId) };
}

function needsRefresh(plan: EmployeePlan): boolean {
  return (
    plan.blockTransition !== null ||
    plan.userFields.role !== undefined ||
    plan.userFields.openidId !== undefined ||
    plan.policyFields.departmentId !== undefined
  );
}

function isDeletedEmail(email: string): boolean {
  return email.endsWith('@deleted.invalid');
}

function isAdminDemotion(plan: EmployeePlan, user: IUser | undefined): boolean {
  return (
    user !== undefined &&
    isAdminLevel(user.role) &&
    plan.userFields.role !== undefined &&
    !isAdminLevel(plan.userFields.role)
  );
}

function isMassDangerous(plan: EmployeePlan, user: IUser | undefined): boolean {
  return user !== undefined && (plan.blockTransition === 'block' || isAdminDemotion(plan, user));
}

function stripDangerous(plan: EmployeePlan, user: IUser | undefined): EmployeePlan {
  if (!user) {
    return plan;
  }
  const next: EmployeePlan = {
    ...plan,
    changes: [...plan.changes],
    userFields: { ...plan.userFields },
    policyFields: { ...plan.policyFields },
  };
  if (next.blockTransition === 'block') {
    delete next.policyFields.blocked;
    next.blockTransition = null;
    next.changes = next.changes.filter((change) => change.kind !== 'block');
    if (next.emailTo !== undefined && isDeletedEmail(next.emailTo)) {
      delete next.emailTo;
      next.changes = next.changes.filter((change) => change.kind !== 'email');
    }
  }
  if (isAdminDemotion(plan, user)) {
    delete next.userFields.role;
    next.changes = next.changes.filter((change) => change.kind !== 'role');
  }
  return next;
}

async function applyEmployeePlan(
  deps: DirectorySyncDeps,
  plan: EmployeePlan,
  user: IUser | undefined,
  conflicts: DirectorySyncConflict[],
  activeKeys: Set<string>,
): Promise<string | null> {
  let userId = user?._id.toString();
  if (!plan.createData && !userId) {
    return null;
  }

  if (plan.createData) {
    const created = await deps.createUser(plan.createData);
    userId = created._id.toString();
    for (const change of plan.changes) {
      change.userId = userId;
    }
  } else if (Object.keys(plan.userFields).length > 0) {
    await deps.updateUser(userId as string, plan.userFields);
  }

  if (plan.emailTo !== undefined) {
    try {
      await deps.updateUser(userId as string, { email: plan.emailTo });
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      const conflict: DirectorySyncConflict = { kind: 'email_taken', userId };
      conflicts.push(conflict);
      logConflictOnce(conflict, activeKeys);
    }
  }

  if (Object.keys(plan.policyFields).length > 0) {
    await deps.upsertUserPolicy(userId as string, plan.policyFields);
  }
  if (plan.blockTransition === 'block') {
    deps.invalidateBlockedUser(userId as string);
    await deps.deleteAllUserSessions(userId as string);
  } else if (plan.blockTransition === 'unblock') {
    deps.invalidateBlockedUser(userId as string);
  }
  return userId as string;
}

interface ApplyContext {
  lookup: DepartmentLookup;
  conflicts: DirectorySyncConflict[];
  activeKeys: Set<string>;
  suppressDangerous: boolean;
}

async function applyEmployeeResolved(
  deps: DirectorySyncDeps,
  employee: DirectoryEmployee,
  initial: { user?: IUser; plan: EmployeePlan },
  context: ApplyContext,
): Promise<{ userId: string | null; plan: EmployeePlan }> {
  let { user, plan } = initial;
  for (let attempt = 0; ; attempt++) {
    try {
      const userId = await applyEmployeePlan(
        deps,
        plan,
        user,
        context.conflicts,
        context.activeKeys,
      );
      return { userId, plan };
    } catch (error) {
      if (!plan.createData || !isMongoDuplicateKeyError(error)) {
        throw error;
      }
      const current = await readCurrent(deps, employee);
      if (current.user && current.mismatch) {
        const conflict: DirectorySyncConflict = {
          kind: 'sub_mismatch',
          userId: current.user._id.toString(),
          employeeId: employee.id,
        };
        context.conflicts.push(conflict);
        logConflictOnce(conflict, context.activeKeys);
        return { userId: null, plan: { ...plan, changes: [] } };
      }
      if (current.user && attempt === 0) {
        const fresh = await deps.client.getEmployee(employee.id);
        if (!fresh.ok) {
          logger.warn('[directorySync] Could not re-read employee, change is postponed', {
            employeeId: employee.id,
          });
          return { userId: null, plan: { ...plan, changes: [] } };
        }
        user = current.user;
        plan = planEmployee(fresh.value, user, current.policy, context.lookup, deps.issuer);
        if (context.suppressDangerous) {
          plan = stripDangerous(plan, user);
        }
        continue;
      }
      const conflict: DirectorySyncConflict = {
        kind: classifyDuplicate(error),
        employeeId: employee.id,
      };
      context.conflicts.push(conflict);
      logConflictOnce(conflict, context.activeKeys);
      throw error;
    }
  }
}

function matchKey(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeName(value: string | undefined): string {
  return (value ?? '').trim();
}

interface DepartmentReconcile {
  changes: DirectorySyncChange[];
  mapped: IDepartment | null | undefined;
  pendingDelete?: IDepartment;
}

type DirectoryDepartmentLookup = Map<string, DirectoryDepartment>;

function isGoneInDirectory(
  mongoDepartment: IDepartment,
  directoryById: DirectoryDepartmentLookup,
): boolean {
  if (!mongoDepartment.directoryId) {
    return false;
  }
  const found = directoryById.get(mongoDepartment.directoryId);
  return !found || found.deleted_at != null;
}

async function reconcileDepartment(
  deps: DirectorySyncDeps,
  department: DirectoryDepartment,
  mongoDepartments: IDepartment[],
  directoryById: DirectoryDepartmentLookup,
  apply: boolean,
  directoryListed = true,
): Promise<DepartmentReconcile> {
  const changes: DirectorySyncChange[] = [];
  const deleted = department.deleted_at != null;
  let existing = mongoDepartments.find((candidate) => candidate.directoryId === department.id);

  if (!existing) {
    if (deleted) {
      return { changes, mapped: null };
    }
    const lowered = matchKey(department.name);
    const candidates = mongoDepartments.filter(
      (candidate) =>
        matchKey(candidate.name) === lowered &&
        (!candidate.directoryId ||
          (directoryListed && isGoneInDirectory(candidate, directoryById))),
    );
    const byName = candidates.find((candidate) => !candidate.directoryId) ?? candidates[0];
    if (byName) {
      changes.push({
        kind: 'department_linked',
        departmentId: byName._id.toString(),
        from: byName.directoryId ?? null,
        to: department.id,
      });
      const updated = apply
        ? await deps.updateDepartment(byName._id.toString(), { directoryId: department.id })
        : null;
      existing =
        updated ??
        (Object.assign(Object.create(Object.getPrototypeOf(byName)), byName, {
          directoryId: department.id,
        }) as IDepartment);
      mongoDepartments[mongoDepartments.indexOf(byName)] = existing;
    } else {
      if (apply) {
        const created = await deps.createDepartment({
          name: department.name,
          description: department.description,
          directoryId: department.id,
        });
        mongoDepartments.push(created);
        changes.push({
          kind: 'department_created',
          departmentId: created._id.toString(),
          from: null,
          to: department.name,
        });
        return { changes, mapped: created };
      }
      const virtual = {
        _id: { toString: () => `new:${department.id}` },
        name: department.name,
        description: department.description,
        directoryId: department.id,
      } as unknown as IDepartment;
      mongoDepartments.push(virtual);
      changes.push({
        kind: 'department_created',
        departmentId: virtual._id.toString(),
        from: null,
        to: department.name,
      });
      return { changes, mapped: virtual };
    }
  }

  const departmentId = existing._id.toString();
  if (deleted) {
    return { changes, mapped: null, pendingDelete: existing };
  }

  const nameChanged = normalizeName(existing.name) !== normalizeName(department.name);
  const descriptionChanged = (existing.description ?? '') !== (department.description ?? '');
  if (nameChanged || descriptionChanged) {
    const change: DirectorySyncChange = {
      kind: 'department_updated',
      departmentId,
      from: existing.name,
      to: department.name,
    };
    if (apply) {
      const fields: { name?: string; description?: string } = {};
      if (nameChanged) {
        fields.name = department.name;
      }
      if (descriptionChanged) {
        fields.description = department.description ?? '';
      }
      try {
        const updated = await deps.updateDepartment(departmentId, fields);
        if (updated) {
          existing = updated;
        }
      } catch (error) {
        if (!isMongoDuplicateKeyError(error)) {
          throw error;
        }
        logger.warn('[directorySync] Department name is taken, update is postponed', {
          departmentId,
        });
        return { changes, mapped: existing };
      }
    }
    changes.push(change);
  }
  return { changes, mapped: existing };
}

async function releaseCollidingNames(
  deps: DirectorySyncDeps,
  directoryDepartments: DirectoryDepartment[],
  departments: IDepartment[],
): Promise<void> {
  const byDirectoryId = new Map<string, IDepartment>();
  for (const department of departments) {
    if (department.directoryId) {
      byDirectoryId.set(department.directoryId, department);
    }
  }
  const renamed = new Set<string>();
  const targetOwner = new Map<string, string>();
  for (const directoryDepartment of directoryDepartments) {
    const mongo = byDirectoryId.get(directoryDepartment.id);
    if (
      directoryDepartment.deleted_at == null &&
      mongo &&
      normalizeName(mongo.name) !== normalizeName(directoryDepartment.name)
    ) {
      renamed.add(mongo._id.toString());
      targetOwner.set(normalizeName(directoryDepartment.name), mongo._id.toString());
    }
  }
  for (let index = 0; index < departments.length; index++) {
    const mongo = departments[index];
    const id = mongo._id.toString();
    const owner = targetOwner.get(mongo.name);
    if (renamed.has(id) && owner !== undefined && owner !== id) {
      const updated = await deps.updateDepartment(id, {
        name: `${mongo.name} [${mongo.directoryId}]`,
      });
      if (updated) {
        departments[index] = updated;
      }
    }
  }
}

async function finishDepartmentDelete(
  deps: DirectorySyncDeps,
  department: IDepartment,
  apply: boolean,
  leavers: number,
  changes: DirectorySyncChange[],
  conflicts: DirectorySyncConflict[],
): Promise<void> {
  const departmentId = department._id.toString();
  const members = await deps.countDepartmentMembers(departmentId);
  const remaining = apply ? members : members - leavers;
  if (remaining > 0) {
    conflicts.push({ kind: 'department_in_use', departmentId });
    return;
  }
  changes.push({ kind: 'department_deleted', departmentId, from: department.name, to: null });
  if (apply) {
    await deps.deleteDepartment(departmentId);
  }
}

interface PlannedEmployee {
  employee: DirectoryEmployee;
  user: IUser | undefined;
  policy: IUserPolicy | undefined;
  plan: EmployeePlan;
}

function predictEmailConflicts(
  mongoUsers: IUser[],
  entries: PlannedEmployee[],
  conflicts: DirectorySyncConflict[],
): void {
  const owners = new Map<string, Set<string>>();
  const add = (email: string, id: string) => {
    const key = email.toLowerCase();
    const set = owners.get(key) ?? new Set<string>();
    set.add(id);
    owners.set(key, set);
  };
  for (const user of mongoUsers) {
    if (user.email) {
      add(user.email, user._id.toString());
    }
  }
  for (const { employee, user, plan } of entries) {
    if (plan.createData?.email) {
      add(plan.createData.email, `new:${employee.id}`);
    } else if (user && plan.emailTo !== undefined) {
      owners.get(user.email.toLowerCase())?.delete(user._id.toString());
      add(plan.emailTo, user._id.toString());
    }
  }
  for (const { employee, user, plan } of entries) {
    if (plan.createData?.email) {
      if ((owners.get(plan.createData.email.toLowerCase())?.size ?? 0) > 1) {
        conflicts.push({ kind: 'email_taken', employeeId: employee.id });
      }
    } else if (user && plan.emailTo !== undefined) {
      if ((owners.get(plan.emailTo.toLowerCase())?.size ?? 0) > 1) {
        conflicts.push({ kind: 'email_taken', userId: user._id.toString() });
      }
    }
  }
}

async function applyPlannedEmployee(
  deps: DirectorySyncDeps,
  entry: PlannedEmployee,
  context: ApplyContext,
): Promise<EmployeePlan | null> {
  return withEmployeeLock(entry.employee.id, async () => {
    let { employee, user, plan } = entry;
    if (user && needsRefresh(plan)) {
      const result = await deps.client.getEmployee(employee.id);
      const userId = user._id.toString();
      const [users, policies] = await Promise.all([
        deps.findUsers({ _id: user._id }, USER_FIELDS),
        deps.listUserPolicies([userId]),
      ]);
      const freshUser = users.find((candidate) => candidate._id.toString() === userId);
      if (!result.ok || !freshUser) {
        logger.warn('[directorySync] Could not re-read employee, change is postponed', {
          employeeId: employee.id,
        });
        return null;
      }
      employee = result.value;
      user = freshUser;
      plan = planEmployee(employee, user, policies.get(userId), context.lookup, deps.issuer);
      if (context.suppressDangerous) {
        plan = stripDangerous(plan, user);
      }
    }
    const applied = await applyEmployeeResolved(deps, employee, { user, plan }, context);
    return applied.plan;
  });
}

async function runDirectorySyncInternal(
  deps: DirectorySyncDeps,
  mode: 'report' | 'apply',
): Promise<DirectorySyncReport> {
  const apply = mode === 'apply';
  const changes: DirectorySyncChange[] = [];
  const conflicts: DirectorySyncConflict[] = [];

  const [employeesResult, departmentsResult] = await Promise.all([
    deps.client.listEmployees(),
    deps.client.listDepartments(),
  ]);
  if (!employeesResult.ok || !departmentsResult.ok) {
    logger.error('[directorySync] directory request failed', {
      employees: employeesResult.ok ? 'ok' : employeesResult.reason,
      departments: departmentsResult.ok ? 'ok' : departmentsResult.reason,
    });
    return { changes: [], conflicts: [], applied: false, aborted: 'directory_error' };
  }
  const employees = employeesResult.value;
  const directoryDepartments = departmentsResult.value;

  const [mongoUsers, mongoDepartments] = await Promise.all([
    deps.findUsers({}, USER_FIELDS),
    deps.listDepartments(),
  ]);
  if (employees.length === 0 && mongoUsers.length > 0) {
    logger.error('[directorySync] directory returned an empty employee list while Mongo has users');
    return { changes: [], conflicts: [], applied: false, aborted: 'empty_directory' };
  }

  const policiesById = await deps.listUserPolicies(mongoUsers.map((user) => user._id.toString()));
  const departments = [...mongoDepartments];
  const lookup: DepartmentLookup = new Map();
  const pendingDeletes: IDepartment[] = [];
  const activeKeys = new Set<string>();
  const directoryById: DirectoryDepartmentLookup = new Map(
    directoryDepartments.map((department) => [department.id, department]),
  );

  if (apply) {
    try {
      await releaseCollidingNames(deps, directoryDepartments, departments);
    } catch (error) {
      logger.error('[directorySync] Failed to release colliding department names', { error });
    }
  }

  const orderedDepartments = [
    ...directoryDepartments.filter((department) => department.deleted_at == null),
    ...directoryDepartments.filter((department) => department.deleted_at != null),
  ];
  for (const department of orderedDepartments) {
    try {
      const result = await reconcileDepartment(deps, department, departments, directoryById, apply);
      changes.push(...result.changes);
      if (result.mapped !== undefined) {
        lookup.set(department.id, result.mapped);
      }
      if (result.pendingDelete) {
        pendingDeletes.push(result.pendingDelete);
      }
    } catch (error) {
      logger.error('[directorySync] Failed to reconcile department', {
        departmentId: department.id,
        error,
      });
    }
  }

  for (const department of departments) {
    if (department.directoryId && !directoryById.has(department.directoryId)) {
      conflicts.push({
        kind: 'department_missing_in_directory',
        departmentId: department._id.toString(),
      });
    }
  }

  const byEmployeeId = new Map<string, IUser>();
  const byOpenidId = new Map<string, IUser>();
  for (const user of mongoUsers) {
    if (user.employeeId) {
      byEmployeeId.set(user.employeeId, user);
    }
    if (user.openidId) {
      byOpenidId.set(user.openidId, user);
    }
  }

  const matchedUserIds = new Set<string>();
  const leavers = new Map<string, number>();

  const ordered = [
    ...employees.filter((employee) => employee.deleted_at != null),
    ...employees.filter((employee) => employee.deleted_at == null),
  ];

  let entries: PlannedEmployee[] = [];
  for (const employee of ordered) {
    const resolved = resolveUser(
      employee,
      byEmployeeId.get(employee.id),
      byOpenidId.get(employee.sub),
    );
    const { user } = resolved;
    if (user) {
      matchedUserIds.add(user._id.toString());
    }
    if (resolved.mismatch && user) {
      matchedUserIds.add(resolved.mismatch._id.toString());
      conflicts.push({
        kind: 'sub_mismatch',
        userId: user._id.toString(),
        employeeId: employee.id,
      });
      continue;
    }
    const policy = user ? policiesById.get(user._id.toString()) : undefined;
    entries.push({
      employee,
      user,
      policy,
      plan: planEmployee(employee, user, policy, lookup, deps.issuer),
    });
  }

  const dangerous = entries.filter((entry) => isMassDangerous(entry.plan, entry.user));
  const maxDangerous = resolveMaxDangerousChanges();
  let aborted: DirectorySyncReport['aborted'];
  let heldBack = 0;
  if (dangerous.length > maxDangerous) {
    aborted = 'too_many_changes';
    heldBack = dangerous.length;
    logAbortOnce(
      dangerous.map((entry) => entry.employee.id),
      maxDangerous,
      activeKeys,
    );
    entries = entries.map((entry) => ({
      ...entry,
      plan: stripDangerous(entry.plan, entry.user),
    }));
  }

  if (!apply) {
    predictEmailConflicts(mongoUsers, entries, conflicts);
  }

  const context: ApplyContext = {
    lookup,
    conflicts,
    activeKeys,
    suppressDangerous: aborted === 'too_many_changes',
  };

  for (const entry of entries) {
    let finalPlan: EmployeePlan | null = entry.plan;
    if (apply) {
      try {
        finalPlan = await applyPlannedEmployee(deps, entry, context);
      } catch (error) {
        finalPlan = null;
        if (!isMongoDuplicateKeyError(error) || !entry.plan.createData) {
          logger.error('[directorySync] Failed to apply employee', {
            employeeId: entry.employee.id,
            error,
          });
        }
      }
    }
    if (!finalPlan) {
      continue;
    }
    for (const change of finalPlan.changes) {
      if (change.kind === 'department' && change.from) {
        leavers.set(change.from, (leavers.get(change.from) ?? 0) + 1);
      }
    }
    changes.push(...finalPlan.changes);
  }

  for (const department of pendingDeletes) {
    try {
      await finishDepartmentDelete(
        deps,
        department,
        apply,
        leavers.get(department._id.toString()) ?? 0,
        changes,
        conflicts,
      );
    } catch (error) {
      logger.error('[directorySync] Failed to delete department', {
        departmentId: department._id.toString(),
        error,
      });
    }
  }

  for (const user of mongoUsers) {
    if (user.openidId && !matchedUserIds.has(user._id.toString())) {
      conflicts.push({ kind: 'missing_in_directory', userId: user._id.toString() });
    }
  }

  for (const change of changes) {
    logChangeOnce(change, activeKeys);
  }
  for (const conflict of conflicts) {
    logConflictOnce(conflict, activeKeys);
  }
  pruneStaleKeys(activeKeys);

  return aborted
    ? { changes, conflicts, applied: apply, aborted, heldBack }
    : { changes, conflicts, applied: apply };
}

export async function runDirectorySync(
  deps: DirectorySyncDeps,
  mode: 'report' | 'apply',
): Promise<DirectorySyncReport> {
  return deps.runAsSystem(() => runDirectorySyncInternal(deps, mode));
}

function buildLookup(departments: IDepartment[]): DepartmentLookup {
  const lookup: DepartmentLookup = new Map();
  for (const department of departments) {
    if (department.directoryId) {
      lookup.set(department.directoryId, department);
    }
  }
  return lookup;
}

export async function syncDirectoryEmployee(
  deps: DirectorySyncDeps,
  employee: DirectoryEmployee,
): Promise<{ userId: string | null }> {
  return deps.runAsSystem(() =>
    withEmployeeLock(employee.id, async () => {
      const [current, departments] = await Promise.all([
        readCurrent(deps, employee),
        deps.listDepartments(),
      ]);
      const conflicts: DirectorySyncConflict[] = [];
      const activeKeys = new Set<string>();
      if (current.user && current.mismatch) {
        logConflictOnce(
          { kind: 'sub_mismatch', userId: current.user._id.toString(), employeeId: employee.id },
          activeKeys,
        );
        return { userId: null };
      }
      const lookup = buildLookup(departments);
      const plan = planEmployee(employee, current.user, current.policy, lookup, deps.issuer);
      const applied = await applyEmployeeResolved(
        deps,
        employee,
        { user: current.user, plan },
        { lookup, conflicts, activeKeys, suppressDangerous: false },
      );
      for (const change of applied.plan.changes) {
        logChangeOnce(change, activeKeys);
      }
      return { userId: applied.userId };
    }),
  );
}

export async function syncDirectoryDepartment(
  deps: DirectorySyncDeps,
  department: DirectoryDepartment,
): Promise<void> {
  return deps.runAsSystem(async () => {
    const departments = [...(await deps.listDepartments())];
    const listed = await deps.client.listDepartments();
    const directoryById: DirectoryDepartmentLookup = new Map();
    if (listed.ok) {
      for (const candidate of listed.value) {
        directoryById.set(candidate.id, candidate);
      }
    }
    directoryById.set(department.id, department);
    const result = await reconcileDepartment(
      deps,
      department,
      departments,
      directoryById,
      true,
      listed.ok,
    );
    const changes = [...result.changes];
    const conflicts: DirectorySyncConflict[] = [];
    if (result.pendingDelete) {
      await finishDepartmentDelete(deps, result.pendingDelete, true, 0, changes, conflicts);
    }
    const activeKeys = new Set<string>();
    for (const change of changes) {
      logChangeOnce(change, activeKeys);
    }
    for (const conflict of conflicts) {
      logConflictOnce(conflict, activeKeys);
    }
  });
}

function parseSyncMode(raw: unknown): DirectorySyncMode {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'off' || value === 'report' || value === 'apply') {
    return value;
  }
  if (value !== '') {
    logger.error('[directorySync] Unknown ADMIN_API_SYNC_MODE value, defaulting to off', {
      value: raw,
    });
  }
  return 'off';
}

export function startDirectorySync(
  deps: DirectorySyncDeps,
  options?: { mode?: DirectorySyncMode; intervalMs?: number },
): () => void {
  const mode = parseSyncMode(options?.mode ?? process.env.ADMIN_API_SYNC_MODE);
  if (mode === 'off') {
    return () => {};
  }

  if (!deps.client.isConfigured()) {
    logger.warn('[directorySync] admin-api is not configured — sync stays off');
    return () => {};
  }

  const intervalMs = options?.intervalMs ?? resolveConfiguredIntervalMs();

  let running = false;
  const run = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runDirectorySync(deps, mode);
    } catch (error) {
      logger.error('[directorySync] Unexpected error during sync run', error);
    } finally {
      running = false;
    }
  };

  const initialTimer = setTimeout(run, 30000);
  const interval = setInterval(run, intervalMs);
  initialTimer.unref?.();
  interval.unref?.();

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
