import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import { SystemRoles, isAdminLevelRole, ADMIN_NO_DEPARTMENT } from 'librechat-data-provider';
import type { FilterQuery } from 'mongoose';
import type {
  IDepartment,
  IKnowledgeSpace,
  IUser,
  IUserPolicy,
  PartialLimits,
  SpendQuery,
  SpendRow,
  AdminUserPage,
  AdminUserPageRow,
  AdminUserPageQuery,
  AdminUserListUser,
} from '@librechat/data-schemas';
import type {
  AdminSpendTotals,
  AdminUserListItem,
  AdminUpdateUserRequest,
  AdminUpdateUserAiRoleRequest,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { CorporatePolicyMethods, EffectivePolicy } from '~/corporate';
import type { ServerRequest } from '~/types/http';
import { invalidateBlockedUser, resolvePolicy, toResolvePolicyDeps } from '~/corporate';
import { parsePagination } from '../pagination';
import { validateModelSelection } from './selection';
import { spaceAllowsDepartment } from './knowledge';
import { validatePartialLimits } from './limitsValidation';
import { validateSpaceOverrides } from './spacesValidation';
import { startOfMonth, startOfToday } from './windows';
import { requestUserId } from './context';
import { resolveRequestDepartmentScope } from './departmentScope';

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AI_ASSIGNABLE_ROLES = new Set<string>([SystemRoles.HEAD, SystemRoles.USER]);

const DIRECTORY_FIELDS_MESSAGE = 'This field is managed in the employee directory';

/** Admin list needs only these fields; reading whole user documents would pull password
 *  hashes and tokens into memory for every row. */
const USER_LIST_PROJECTION = '_id name email role employeeId openidId position';
/**
 * `findUsers`/`findUser` return `.lean()` documents: plain objects with `_id`
 * only. `IUser.id` is a Mongoose virtual that only exists on a hydrated
 * `Document`, so it's absent here even though the base type declares it —
 * typing the deps this way makes reading `.id` on a lean user a compile error
 * instead of a silent `undefined`.
 */
type LeanUser = Omit<IUser, 'id'>;

/**
 * Строку списка можно собрать из четырёх полей, и ровно их отдаёт постраничная
 * агрегация. Требовать здесь полный документ значило бы вытягивать из базы хэши
 * паролей и токены ради имени и почты.
 */
type UserListSource = AdminUserListUser;

const ZERO_SPEND: AdminSpendTotals = { costUsd: 0, requests: 0 };
export interface UpsertUserPolicyFields {
  limits?: PartialLimits | null;
  allowedModels?: string[] | null;
  defaultModel?: string | null;
  allowedSpaces?: string[];
  deniedSpaces?: string[];
  canUploadKnowledge?: boolean;
}

export interface CorporateUsersDeps extends CorporatePolicyMethods {
  findUser: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<LeanUser | null>;
  updateUser: (userId: string, updateData: Partial<IUser>) => Promise<IUser | null>;
  listDepartments: () => Promise<IDepartment[]>;
  listUserPolicies: (userIds: string[]) => Promise<Map<string, IUserPolicy>>;
  listAdminUserPage: (query: AdminUserPageQuery) => Promise<AdminUserPage>;
  getSpendSummary: (query: SpendQuery) => Promise<SpendRow[]>;
  upsertUserPolicy: (userId: string, fields: UpsertUserPolicyFields) => Promise<IUserPolicy>;
  listSpaces: () => Promise<IKnowledgeSpace[]>;
}

const MAX_USER_SEARCH_LENGTH = 100;

function parseUserSearch(rawSearch: unknown): string {
  return typeof rawSearch === 'string' ? rawSearch.trim().slice(0, MAX_USER_SEARCH_LENGTH) : '';
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface UserListFilters {
  search?: string;
  role?: string;
  departmentId?: string;
  blocked?: boolean;
}

const MAX_ROLE_FILTER_LENGTH = 64;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Роль сравнивается точным равенством, а не регуляркой: список ролей открыт (кастомные
 * роли создаются через ролевой API), но подстановка пользовательской строки в `$regex`
 * дала бы катастрофический бэктрекинг на подобранном вводе.
 */
function parseRoleFilter(raw: unknown): ParseResult<string | undefined> {
  if (raw === undefined || raw === '') {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string' || raw.length > MAX_ROLE_FILTER_LENGTH || CONTROL_CHARS.test(raw)) {
    return { ok: false, error: 'Invalid role filter' };
  }
  return { ok: true, value: raw };
}

function parseDepartmentFilter(raw: unknown): ParseResult<string | undefined> {
  if (raw === undefined || raw === '') {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Invalid department ID format' };
  }
  if (raw === ADMIN_NO_DEPARTMENT || isValidObjectIdString(raw)) {
    return { ok: true, value: raw };
  }
  return { ok: false, error: 'Invalid department ID format' };
}

function parseStatusFilter(raw: unknown): ParseResult<boolean | undefined> {
  if (raw === undefined || raw === '') {
    return { ok: true, value: undefined };
  }
  if (raw === 'active') {
    return { ok: true, value: false };
  }
  if (raw === 'blocked') {
    return { ok: true, value: true };
  }
  return { ok: false, error: 'Invalid status filter' };
}

function parseUserFilters(query: ServerRequest['query']): ParseResult<UserListFilters> {
  const role = parseRoleFilter(query.role);
  if (!role.ok) {
    return role;
  }
  const departmentId = parseDepartmentFilter(query.departmentId);
  if (!departmentId.ok) {
    return departmentId;
  }
  const blocked = parseStatusFilter(query.status);
  if (!blocked.ok) {
    return blocked;
  }

  const search = parseUserSearch(query.search);
  return {
    ok: true,
    value: {
      ...(search !== '' ? { search } : {}),
      ...(role.value !== undefined ? { role: role.value } : {}),
      ...(departmentId.value !== undefined ? { departmentId: departmentId.value } : {}),
      ...(blocked.value !== undefined ? { blocked: blocked.value } : {}),
    },
  };
}

/**
 * Право загрузки в базу знаний имеет смысл только для сотрудника, привязанного к
 * отделу: документы попадают в пространство отдела, и без отдела класть их некуда.
 * Снятие права не завязано на отдел и разрешено всегда.
 */
export function validateKnowledgeUploadFlag(input: {
  canUploadKnowledge?: boolean;
  nextDepartmentId: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (input.canUploadKnowledge !== true) {
    return { ok: true };
  }
  if (input.nextDepartmentId == null) {
    return {
      ok: false,
      error: 'Employee must belong to a department to upload knowledge documents',
    };
  }
  return { ok: true };
}

type UserLookup = { ok: true; criteria: FilterQuery<IUser> } | { ok: false };

function parseUserLookup(id: string): UserLookup {
  if (isValidObjectIdString(id)) {
    return { ok: true, criteria: { _id: id } };
  }
  if (USER_ID_PATTERN.test(id)) {
    return { ok: true, criteria: { employeeId: id } };
  }
  return { ok: false };
}

type DirectoryOwnedFields = Partial<Record<'departmentId' | 'blocked', string | boolean | null>>;

function directoryFieldsDenied(body: DirectoryOwnedFields): string[] {
  return (['departmentId', 'blocked'] as const).filter((field) => body[field] !== undefined);
}

function buildDepartmentIndex(departments: IDepartment[]): Map<string, IDepartment> {
  const byId = new Map<string, IDepartment>();
  for (const department of departments) {
    byId.set(department._id.toString(), department);
  }
  return byId;
}

function buildSpendMap(rows: SpendRow[]): Map<string, AdminSpendTotals> {
  const byUserId = new Map<string, AdminSpendTotals>();
  for (const row of rows) {
    byUserId.set(row.key, { costUsd: row.costUsd, requests: row.requests });
  }
  return byUserId;
}

function buildPolicyDeps(
  policiesById: Map<string, IUserPolicy>,
  departmentIndex: Map<string, IDepartment>,
  cachedGlobalSettings: CorporatePolicyMethods['getGlobalSettings'],
) {
  return toResolvePolicyDeps({
    getGlobalSettings: cachedGlobalSettings,
    getUserPolicy: async (userId) => policiesById.get(userId) ?? null,
    getDepartmentById: async (id) => departmentIndex.get(id) ?? null,
  });
}

function toUserListItem(
  user: UserListSource,
  policy: EffectivePolicy,
  rawPolicy: IUserPolicy | null,
  departmentIndex: Map<string, IDepartment>,
  spendToday: AdminSpendTotals,
  spendMonth: AdminSpendTotals,
): AdminUserListItem {
  return {
    id: user._id.toString(),
    employeeId: user.employeeId ?? null,
    position: user.position ?? '',
    openidId: user.openidId ?? null,
    name: user.name ?? '',
    email: user.email,
    role: user.role ?? 'USER',
    departmentId: policy.departmentId,
    departmentName: policy.departmentId
      ? (departmentIndex.get(policy.departmentId)?.name ?? null)
      : null,
    limits: policy.limits,
    limitsOverride: rawPolicy?.limits ?? null,
    allowedModels: policy.allowedModels,
    allowedModelsOverride: rawPolicy?.allowedModels ?? null,
    defaultModel: policy.defaultModel,
    defaultModelOverride: rawPolicy?.defaultModel ?? null,
    blocked: policy.blocked,
    spendToday,
    spendMonth,
    allowedSpaces: (rawPolicy?.allowedSpaces ?? []).map((id) => id.toString()),
    deniedSpaces: (rawPolicy?.deniedSpaces ?? []).map((id) => id.toString()),
    canUploadKnowledge: rawPolicy?.canUploadKnowledge ?? false,
  };
}

export function createCorporateUsersHandlers(deps: CorporateUsersDeps): {
  listUsers: (req: ServerRequest, res: Response) => Promise<Response>;
  getUser: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUser: (req: ServerRequest, res: Response) => Promise<Response>;
  updateUserAiRole: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  /**
   * Собирает строку списка для одного сотрудника. Отдельная страница редактирования не
   * может взять её из кэша списка: список постраничный, а по прямой ссылке номер
   * страницы неизвестен.
   */
  async function buildUserItem(
    user: UserListSource,
    rawPolicy: IUserPolicy | null,
  ): Promise<AdminUserListItem> {
    const id = user._id.toString();
    const now = new Date();
    const [departments, globalSettings, dailyRows, monthlyRows] = await Promise.all([
      deps.listDepartments(),
      deps.getGlobalSettings(),
      deps.getSpendSummary({ from: startOfToday(), to: now, groupBy: 'user', userId: id }),
      deps.getSpendSummary({ from: startOfMonth(), to: now, groupBy: 'user', userId: id }),
    ]);

    const departmentIndex = buildDepartmentIndex(departments);
    const policyDeps = buildPolicyDeps(
      new Map(rawPolicy ? [[id, rawPolicy]] : []),
      departmentIndex,
      async () => globalSettings,
    );
    const policy = await resolvePolicy(policyDeps, id);

    return toUserListItem(
      user,
      policy,
      rawPolicy,
      departmentIndex,
      buildSpendMap(dailyRows).get(id) ?? ZERO_SPEND,
      buildSpendMap(monthlyRows).get(id) ?? ZERO_SPEND,
    );
  }

  async function listUsersHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const query = req.query as { limit?: string; offset?: string };
      const { limit, offset } = parsePagination(query);
      const filters = parseUserFilters(req.query);
      if (!filters.ok) {
        return res.status(400).json({ error: filters.error });
      }
      /** Глава видит только свой отдел: фильтр запроса не может его расширить. */
      if (scope.departmentId != null) {
        filters.value.departmentId = scope.departmentId;
      }
      const now = new Date();

      const [page, departments, globalSettings, dailySpendRows, monthlySpendRows] =
        await Promise.all([
          deps.listAdminUserPage({ ...filters.value, limit, offset }),
          deps.listDepartments(),
          deps.getGlobalSettings(),
          deps.getSpendSummary({ from: startOfToday(), to: now, groupBy: 'user' }),
          deps.getSpendSummary({ from: startOfMonth(), to: now, groupBy: 'user' }),
        ]);

      const departmentIndex = buildDepartmentIndex(departments);
      const cachedGlobalSettings = async () => globalSettings;
      const dailySpend = buildSpendMap(dailySpendRows);
      const monthlySpend = buildSpendMap(monthlySpendRows);
      /** Policies ride along with the page, so no second round trip is needed here. */
      const policiesById = new Map<string, IUserPolicy>();
      for (const row of page.rows) {
        if (row.policy != null) {
          policiesById.set(row.user._id.toString(), row.policy);
        }
      }
      const policyDeps = buildPolicyDeps(policiesById, departmentIndex, cachedGlobalSettings);

      const users = await Promise.all(
        page.rows.map(async (row: AdminUserPageRow) => {
          const userId = row.user._id.toString();
          const policy = await resolvePolicy(policyDeps, userId);
          return toUserListItem(
            row.user,
            policy,
            row.policy,
            departmentIndex,
            dailySpend.get(userId) ?? ZERO_SPEND,
            monthlySpend.get(userId) ?? ZERO_SPEND,
          );
        }),
      );

      return res.status(200).json({ users, total: page.total, limit, offset });
    } catch (error) {
      logger.error('[corporateUsers] listUsers error:', error);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  async function getUserHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const lookup = parseUserLookup((req.params as { id: string }).id);
      if (!lookup.ok) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const user = await deps.findUser(lookup.criteria, USER_LIST_PROJECTION);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const id = user._id.toString();

      const policies = await deps.listUserPolicies([id]);
      if (scope.departmentId != null) {
        const targetDepartmentId = policies.get(id)?.departmentId?.toString() ?? null;
        if (targetDepartmentId !== scope.departmentId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }
      return res.status(200).json({ user: await buildUserItem(user, policies.get(id) ?? null) });
    } catch (error) {
      logger.error('[corporateUsers] getUser error:', error);
      return res.status(500).json({ error: 'Failed to load user' });
    }
  }

  async function updateUserHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const scope = await resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const lookup = parseUserLookup((req.params as { id: string }).id);
      if (!lookup.ok) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const body = req.body as AdminUpdateUserRequest & DirectoryOwnedFields;
      const deniedFields = directoryFieldsDenied(body);
      if (deniedFields.length > 0) {
        return res.status(400).json({
          error: DIRECTORY_FIELDS_MESSAGE,
          error_code: 'FIELD_NOT_EDITABLE',
          fields: deniedFields,
        });
      }

      const user = await deps.findUser(lookup.criteria, USER_LIST_PROJECTION);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const id = user._id.toString();

      /**
       * Глава не может править собственную карточку. Иначе любое послабление,
       * которое ей разрешено применить к подчинённому (например, `allowedSpaces`),
       * она применила бы и к себе — самопроверка «цель из моего отдела» её не
       * поймает, потому что отдел главы совпадает с её собственным. У админ-уровневых
       * ролей `scope.departmentId` равен `null`, так что запрет их не касается.
       */
      if (scope.departmentId != null && callerId === id) {
        return res.status(403).json({ error: 'Department heads cannot edit their own account' });
      }

      /**
       * Без этой проверки роль владельца защищена, а сам владелец — нет: администратор
       * послал бы сюда `{ blocked: true }` и добился ровно того же результата, что и
       * запрещённое понижение, только через другое поле.
       */
      if (req.user?.role !== SystemRoles.OWNER && user.role === SystemRoles.OWNER) {
        return res.status(403).json({ error: 'Only an owner can modify an owner' });
      }

      const {
        limits,
        allowedModels,
        defaultModel,
        allowedSpaces,
        deniedSpaces,
        canUploadKnowledge,
      } = body;

      /**
       * Главе доступны только право загрузки и видимость пространств знаний — лимиты и
       * модели подчинённого меняет только админ-уровневая роль. Проверка на сервере, а не
       * только в интерфейсе: `scope.departmentId` не пуст только у главы (у админа и
       * владельца `resolveDepartmentScope` возвращает `null`).
       */
      if (
        scope.departmentId != null &&
        (limits !== undefined || allowedModels !== undefined || defaultModel !== undefined)
      ) {
        return res.status(403).json({
          error:
            'Department heads may only change canUploadKnowledge, allowedSpaces or deniedSpaces',
        });
      }

      /**
       * Политика цели читается не более одного раза за запрос: этот же промис
       * переиспользуют проверка отдела главы ниже и `currentPolicy`/`referencePolicy`
       * дальше по обработчику.
       */
      let targetPolicyPromise: ReturnType<typeof deps.getUserPolicy> | null = null;
      const getTargetPolicy = (): ReturnType<typeof deps.getUserPolicy> => {
        if (!targetPolicyPromise) {
          targetPolicyPromise = deps.getUserPolicy(id);
        }
        return targetPolicyPromise;
      };

      if (scope.departmentId != null) {
        const targetPolicy = await getTargetPolicy();
        const targetDepartmentId = targetPolicy?.departmentId?.toString() ?? null;
        if (targetDepartmentId !== scope.departmentId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      const currentPolicy =
        allowedModels !== undefined || defaultModel !== undefined ? await getTargetPolicy() : null;
      const selection = validateModelSelection(
        { allowedModels, defaultModel },
        {
          allowedModels: currentPolicy?.allowedModels ?? null,
          defaultModel: currentPolicy?.defaultModel ?? null,
        },
      );
      if (!selection.ok) {
        return res.status(400).json({ error: selection.error });
      }

      let validatedLimits: PartialLimits | null | undefined;
      if (limits !== undefined) {
        if (limits === null) {
          validatedLimits = null;
        } else {
          const limitsValidation = validatePartialLimits(limits);
          if (!limitsValidation.ok) {
            return res.status(400).json({ error: limitsValidation.error });
          }
          validatedLimits = limitsValidation.limits;
        }
      }

      let validatedSpaceFields: { allowedSpaces?: string[]; deniedSpaces?: string[] } = {};
      if (allowedSpaces !== undefined || deniedSpaces !== undefined) {
        const spaces = await deps.listSpaces();
        const allSpaceIds = new Set(spaces.map((space) => space._id.toString()));
        /**
         * `allowedSpaces` и `deniedSpaces` сужены по-разному, хоть и лежат рядом:
         * `allowedSpaces` расширяет доступ — через него глава дотягивалась бы до
         * чужих отделов, поэтому оно ограничено пространствами её собственного
         * отдела. `deniedSpaces` только отнимает доступ у уже подчинённого ей
         * сотрудника — худшее, что этим можно сделать, это скрыть от него документ,
         * который тот и так видит (и админ увидит запрет в карточке и снимет его),
         * поэтому оно принимает любое существующее пространство. Сузить оба
         * одинаково значило бы отобрать у главы единственный способ ограничить
         * своего же сотрудника в общедоступном пространстве.
         */
        const headDepartmentId = scope.departmentId;
        const allowedSpaceIds =
          headDepartmentId == null
            ? allSpaceIds
            : new Set(
                spaces
                  .filter((space) => spaceAllowsDepartment(space, headDepartmentId))
                  .map((space) => space._id.toString()),
              );

        const allowedValidation = validateSpaceOverrides({ allowedSpaces }, allowedSpaceIds);
        if (!allowedValidation.ok) {
          return res.status(400).json({ error: allowedValidation.error });
        }
        const deniedValidation = validateSpaceOverrides({ deniedSpaces }, allSpaceIds);
        if (!deniedValidation.ok) {
          return res.status(400).json({ error: deniedValidation.error });
        }
        validatedSpaceFields = { ...allowedValidation.fields, ...deniedValidation.fields };
      }

      const referencePolicy = canUploadKnowledge === true ? await getTargetPolicy() : null;
      const uploadFlag = validateKnowledgeUploadFlag({
        canUploadKnowledge,
        nextDepartmentId: referencePolicy?.departmentId?.toString() ?? null,
      });
      if (!uploadFlag.ok) {
        return res.status(400).json({ error: uploadFlag.error });
      }

      const fields: UpsertUserPolicyFields = {};
      if (validatedSpaceFields.allowedSpaces !== undefined) {
        fields.allowedSpaces = validatedSpaceFields.allowedSpaces;
      }
      if (validatedSpaceFields.deniedSpaces !== undefined) {
        fields.deniedSpaces = validatedSpaceFields.deniedSpaces;
      }
      if (validatedLimits !== undefined) {
        fields.limits = validatedLimits;
      }
      if (selection.fields.allowedModels !== undefined) {
        fields.allowedModels = selection.fields.allowedModels;
      }
      if (selection.fields.defaultModel !== undefined) {
        fields.defaultModel = selection.fields.defaultModel;
      }
      if (canUploadKnowledge !== undefined) {
        fields.canUploadKnowledge = canUploadKnowledge;
      }

      let rawPolicy: IUserPolicy;
      try {
        rawPolicy = await deps.upsertUserPolicy(id, fields);
      } catch (error) {
        logger.error('[corporateUsers] upsertUserPolicy error:', error);
        return res.status(500).json({ error: 'Failed to update user' });
      }

      const now = new Date();
      const [departments, globalSettings, dailyRows, monthlyRows] = await Promise.all([
        deps.listDepartments(),
        deps.getGlobalSettings(),
        deps.getSpendSummary({ from: startOfToday(), to: now, groupBy: 'user', userId: id }),
        deps.getSpendSummary({ from: startOfMonth(), to: now, groupBy: 'user', userId: id }),
      ]);

      const departmentIndex = buildDepartmentIndex(departments);
      const cachedGlobalSettings = async () => globalSettings;
      const policyDeps = buildPolicyDeps(
        new Map([[id, rawPolicy]]),
        departmentIndex,
        cachedGlobalSettings,
      );
      const policy = await resolvePolicy(policyDeps, id);
      const updated = toUserListItem(
        user,
        policy,
        rawPolicy,
        departmentIndex,
        buildSpendMap(dailyRows).get(id) ?? ZERO_SPEND,
        buildSpendMap(monthlyRows).get(id) ?? ZERO_SPEND,
      );

      return res.status(200).json({ user: updated });
    } catch (error) {
      logger.error('[corporateUsers] updateUser error:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  }

  async function updateUserAiRoleHandler(req: ServerRequest, res: Response) {
    try {
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const lookup = parseUserLookup((req.params as { id: string }).id);
      if (!lookup.ok) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const { role: nextRole } = (req.body ?? {}) as Partial<AdminUpdateUserAiRoleRequest>;
      if (typeof nextRole !== 'string' || !AI_ASSIGNABLE_ROLES.has(nextRole)) {
        return res
          .status(400)
          .json({ error: 'Role must be HEAD or USER', error_code: 'INVALID_ROLE' });
      }

      const target = await deps.findUser(lookup.criteria, USER_LIST_PROJECTION);
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }
      const id = target._id.toString();

      if (requestUserId(req) === id) {
        return res.status(403).json({ error: 'Cannot change your own role' });
      }

      const targetRole = target.role ?? SystemRoles.USER;
      if (isAdminLevelRole(targetRole)) {
        return res.status(409).json({
          error: 'Administrator roles are managed in the employee directory',
          error_code: 'TARGET_IS_ADMIN',
        });
      }

      if (targetRole !== SystemRoles.USER && targetRole !== SystemRoles.HEAD) {
        return res.status(409).json({
          error: 'This role is not managed here',
          error_code: 'ROLE_NOT_MANAGED',
        });
      }

      const targetPolicy = await deps.getUserPolicy(id);
      if (nextRole === SystemRoles.HEAD && targetPolicy?.departmentId == null) {
        return res.status(400).json({
          error: 'Assign a department before making the employee a department head',
          error_code: 'HEAD_REQUIRES_DEPARTMENT',
        });
      }

      if (targetRole === nextRole) {
        const policies = await deps.listUserPolicies([id]);
        return res
          .status(200)
          .json({ user: await buildUserItem(target, policies.get(id) ?? null) });
      }

      /** Пишем через `updateUser`, а не сырым апдейтом: он инвалидирует auth-кэш. */
      const updated = await deps.updateUser(id, { role: nextRole });
      if (!updated) {
        return res.status(404).json({ error: 'User not found' });
      }

      /** Роль участвует в разрешении доступа, поэтому кэш блокировок тоже устарел. */
      invalidateBlockedUser(id);

      const policies = await deps.listUserPolicies([id]);
      logger.info('[corporateUsers] Role changed', { userId: id, from: targetRole, to: nextRole });
      return res.status(200).json({
        user: await buildUserItem({ ...target, role: nextRole }, policies.get(id) ?? null),
      });
    } catch (error) {
      logger.error('[corporateUsers] updateUserAiRole error:', error);
      return res.status(500).json({ error: 'Failed to update user role' });
    }
  }

  return {
    listUsers: listUsersHandler,
    getUser: getUserHandler,
    updateUser: updateUserHandler,
    updateUserAiRole: updateUserAiRoleHandler,
  };
}
