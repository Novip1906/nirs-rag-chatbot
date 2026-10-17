import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type {
  ICorporateSettings,
  IDepartment,
  ILimitRequest,
  ILimits,
  IUser,
  IUserPolicy,
  LimitRequestStatus,
  PartialLimits,
} from '@librechat/data-schemas';
import type {
  AdminApproveLimitRequestRequest,
  AdminLimitRequest,
  AdminLimitRequestHistoryEntry,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { PolicyLimits } from '~/corporate';
import type { ServerRequest } from '~/types/http';
import { mergeLimits, resolveLimits } from '~/corporate';
import { requestUserId } from './context';
import { validatePartialLimits } from './limitsValidation';
import { resolveRequestDepartmentScope } from './departmentScope';

/**
 * `findUsers` returns `.lean()` documents: plain objects with `_id` only, no
 * Mongoose `id` virtual — typing the dep this way turns a `.id` read into a
 * compile error instead of a silent `undefined`.
 */
type LeanUser = Omit<IUser, 'id'>;

export interface CorporateLimitRequestsDeps {
  getLimitRequestById: (id: string, status?: LimitRequestStatus) => Promise<ILimitRequest | null>;
  listLimitRequests: (status?: LimitRequestStatus) => Promise<ILimitRequest[]>;
  listLimitRequestsByUsers: (userIds: string[]) => Promise<ILimitRequest[]>;
  resolveLimitRequest: (
    id: string,
    status: 'approved' | 'rejected',
    resolvedBy: string,
    limitAfter?: number | null,
  ) => Promise<ILimitRequest | null>;
  upsertUserPolicy: (userId: string, fields: { limits: PartialLimits }) => Promise<IUserPolicy>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<LeanUser[]>;
  /**
   * `limits` added to the `Pick` alongside `departmentId`: `approveLimitRequestHandler`
   * needs it to know the target's currently-effective limits before merging in an
   * approved window (see `resolveLimits`), not just for department-scope resolution.
   */
  getUserPolicy: (userId: string) => Promise<Pick<IUserPolicy, 'departmentId' | 'limits'> | null>;
  listUserPolicies: (userIds: string[]) => Promise<Map<string, IUserPolicy>>;
  getDepartmentById: (id: string) => Promise<Pick<IDepartment, 'defaultLimits'> | null>;
  getGlobalSettings: () => Promise<Pick<ICorporateSettings, 'defaultLimits'>>;
}

interface UserNameInfo {
  name: string;
  email: string;
}

async function buildUserNameMap(
  findUsers: CorporateLimitRequestsDeps['findUsers'],
  userIds: string[],
): Promise<Map<string, UserNameInfo>> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const users = await findUsers({ _id: { $in: uniqueIds } }, 'name email');
  return new Map(
    users.map((user) => [user._id.toString(), { name: user.name ?? '', email: user.email }]),
  );
}

function toHistoryEntry(request: ILimitRequest): AdminLimitRequestHistoryEntry {
  return {
    id: request._id.toString(),
    window: request.window,
    status: request.status,
    limitBefore: request.limitBefore ?? null,
    limitAfter: request.limitAfter ?? null,
    createdAt: request.createdAt?.toISOString() ?? new Date(0).toISOString(),
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
  };
}

/**
 * Builds each user's request history once, keyed by user id, so a page of requests costs
 * one grouping pass instead of one filter scan per row.
 */
function buildHistoryMap(requests: ILimitRequest[]): Map<string, AdminLimitRequestHistoryEntry[]> {
  const byUserId = new Map<string, AdminLimitRequestHistoryEntry[]>();
  for (const request of requests) {
    const userId = request.userId.toString();
    const entries = byUserId.get(userId);
    if (entries) {
      entries.push(toHistoryEntry(request));
      continue;
    }
    byUserId.set(userId, [toHistoryEntry(request)]);
  }
  return byUserId;
}

export function toAdminLimitRequest(
  request: ILimitRequest,
  userInfo: UserNameInfo | undefined,
  history: AdminLimitRequestHistoryEntry[] = [],
): AdminLimitRequest {
  const id = request._id.toString();
  return {
    id,
    userId: request.userId.toString(),
    userName: userInfo?.name ?? '',
    userEmail: userInfo?.email ?? '',
    window: request.window,
    comment: request.comment,
    status: request.status,
    limitBefore: request.limitBefore ?? null,
    limitAfter: request.limitAfter ?? null,
    history: history.filter((entry) => entry.id !== id),
    resolvedBy: request.resolvedBy ? request.resolvedBy.toString() : null,
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
    createdAt: request.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

/**
 * Отдел сотрудника, которому принадлежит заявка. Единственное место, где заявка
 * связывается с отделом — заявки на лимит своего отдела не хранят. Идёт через
 * `listUserPolicies`, а не `getUserPolicy`: последний зарезервирован за отделом
 * самого вызывающего (`DepartmentScopeDeps`), и путать эти два id в одном методе
 * рискованно — легко подменить чужой отдел своим.
 */
async function departmentOfUser(
  deps: CorporateLimitRequestsDeps,
  userId: string,
): Promise<string | null> {
  const policies = await deps.listUserPolicies([userId]);
  const departmentId = policies.get(userId)?.departmentId;
  return departmentId != null ? departmentId.toString() : null;
}

/**
 * Batched version of `departmentOfUser` for filtering a page of requests: one query
 * for every distinct owner instead of one `getUserPolicy` per row.
 */
async function filterRequestsByDepartment(
  deps: CorporateLimitRequestsDeps,
  requests: ILimitRequest[],
  departmentId: string,
): Promise<ILimitRequest[]> {
  const userIds = Array.from(new Set(requests.map((request) => request.userId.toString())));
  const policies = await deps.listUserPolicies(userIds);
  return requests.filter(
    (request) =>
      (policies.get(request.userId.toString())?.departmentId?.toString() ?? null) === departmentId,
  );
}

type RequestLookup =
  | { ok: true; request: ILimitRequest }
  | { ok: false; reason: 'not_found' | 'forbidden' };

/**
 * Finds a request by id within an (optional) status bucket and, when `departmentId` is
 * set, checks that its owner belongs to that department. Admin-level callers pass
 * `departmentId: null` and pay no extra department lookup at all.
 *
 * Looks the request up directly by id (`getLimitRequestById`) rather than pulling the
 * whole queue into memory to find one row by scanning it: the queue only grows with the
 * company's history, while every approval or rejection needs exactly one request.
 */
async function findRequestInScope(
  deps: CorporateLimitRequestsDeps,
  id: string,
  departmentId: string | null,
  statusFilter?: LimitRequestStatus,
): Promise<RequestLookup> {
  const target = await deps.getLimitRequestById(id, statusFilter);
  if (!target) {
    return { ok: false, reason: 'not_found' };
  }
  if (departmentId == null) {
    return { ok: true, request: target };
  }
  const requestDepartmentId = await departmentOfUser(deps, target.userId.toString());
  if (requestDepartmentId !== departmentId) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, request: target };
}

const LIMIT_KEYS: Array<keyof ILimits> = ['dailyCostUsd'];

/**
 * Одобряя заявку, глава не может поднять денежный лимит выше потолка своего отдела.
 * Потолок — это `defaultLimits` отдела с подстановкой глобального значения там, где у
 * отдела оно не задано (`mergeLimits`, тот же приём, что использует `resolvePolicy` для
 * действующей политики сотрудника): схема отдела задаёт все поля `null` по умолчанию, и
 * без подстановки непроставленный вручную отдел означал бы «потолка нет вовсе», а не
 * «потолок как у компании».
 *
 * `null` в запрошенном поле — это «предела нет» для сотрудника, и оно проверяется наравне
 * с числом: если у потолка есть значение, запрос на снятие ограничения превышает его точно
 * так же, как запрос числа выше потолка. Сравниваются только явно присланные поля —
 * остальные заявкой не трогаются и остаются на прежнем значении политики сотрудника.
 */
function exceedsDepartmentLimit(requested: PartialLimits, ceiling: ILimits): boolean {
  for (const key of LIMIT_KEYS) {
    if (!(key in requested)) {
      continue;
    }
    const cap = ceiling[key];
    if (cap == null) {
      continue;
    }
    const value = requested[key];
    if (value == null || value > cap) {
      return true;
    }
  }
  return false;
}

export function createCorporateLimitRequestsHandlers(deps: CorporateLimitRequestsDeps): {
  listLimitRequests: (req: ServerRequest, res: Response) => Promise<Response>;
  approveLimitRequest: (req: ServerRequest, res: Response) => Promise<Response>;
  rejectLimitRequest: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listLimitRequestsHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const rawStatus = req.query.status;
      const status: LimitRequestStatus | undefined =
        rawStatus === 'pending' || rawStatus === 'approved' || rawStatus === 'rejected'
          ? rawStatus
          : 'pending';

      const allRequests = await deps.listLimitRequests(status);
      const requests =
        scope.departmentId == null
          ? allRequests
          : await filterRequestsByDepartment(deps, allRequests, scope.departmentId);

      const userIds = requests.map((request) => request.userId.toString());
      const [nameMap, allHistoryRequests] = await Promise.all([
        buildUserNameMap(deps.findUsers, userIds),
        deps.listLimitRequestsByUsers(userIds),
      ]);
      const historyMap = buildHistoryMap(allHistoryRequests);

      return res.status(200).json({
        requests: requests.map((request) => {
          const userId = request.userId.toString();
          return toAdminLimitRequest(request, nameMap.get(userId), historyMap.get(userId));
        }),
      });
    } catch (error) {
      logger.error('[corporateLimitRequests] listLimitRequests error:', error);
      return res.status(500).json({ error: 'Failed to list limit requests' });
    }
  }

  async function approveLimitRequestHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid limit request ID format' });
      }

      const { limits } = req.body as AdminApproveLimitRequestRequest;
      const validation = validatePartialLimits(limits);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      const lookup = await findRequestInScope(deps, id, scope.departmentId, 'pending');
      if (!lookup.ok) {
        return lookup.reason === 'forbidden'
          ? res.status(403).json({ error: 'Forbidden' })
          : res.status(404).json({ error: 'Limit request not found or not pending' });
      }
      const target = lookup.request;

      /**
       * Отдел и глобальные лимиты сотрудника, которому принадлежит заявка — не отдел
       * одобряющего (`scope.departmentId`, для главы это одно и то же, `findRequestInScope`
       * уже это проверил, но для админа/владельца заявка может быть из любого отдела).
       * Один и тот же результат нужен и для потолка главы, и для мёржа ниже — запрашиваются
       * один раз.
       */
      const targetUserPolicy = await deps.getUserPolicy(target.userId.toString());
      const targetDepartmentId = targetUserPolicy?.departmentId
        ? targetUserPolicy.departmentId.toString()
        : null;
      const [targetDepartment, globalSettings] = await Promise.all([
        targetDepartmentId ? deps.getDepartmentById(targetDepartmentId) : Promise.resolve(null),
        deps.getGlobalSettings(),
      ]);

      /** Глава не может поднять лимит подчинённого выше предела своего отдела. */
      if (scope.departmentId != null) {
        const ceiling = mergeLimits(globalSettings.defaultLimits, targetDepartment?.defaultLimits);
        if (exceedsDepartmentLimit(validation.limits, ceiling)) {
          return res.status(403).json({ error: 'Requested limit exceeds the department limit' });
        }
      }

      /**
       * Одобрение обязано менять только запрошенное окно — второе должно сохранить то,
       * что действовало до одобрения (свой личный лимит, если уже был, иначе унаследованный
       * от отдела/глобальный). Патч мёржится поверх текущих ЭФФЕКТИВНЫХ лимитов сотрудника
       * (`resolveLimits` — та же логика наследования, что и у `resolvePolicy`), а не поверх
       * пустых дефолтов, которые `upsertUserPolicy` иначе подставил бы для ещё не
       * существующего личного объекта лимитов — иначе патч из одного поля тихо обнулял бы
       * второе: как только личный объект лимитов появляется, наследование от отдела для всех
       * полей выключается разом, не только для тронутого («всё или ничего», см. `policy.ts`).
       */
      const currentLimits = resolveLimits(
        globalSettings.defaultLimits,
        targetDepartment?.defaultLimits,
        targetUserPolicy?.limits,
      );
      const mergedLimits: PolicyLimits = { ...currentLimits, ...validation.limits };

      /**
       * Raise the limit before flipping the request to `approved`. If marking the
       * request fails after this, the personal limit is already up and the request
       * is still open — a retry of this same call fixes it. The reverse order would
       * leave an approved-looking request with no raised limit, invisible in the
       * pending queue and impossible to fix from the admin UI.
       */
      await deps.upsertUserPolicy(target.userId.toString(), { limits: mergedLimits });

      const grantedLimit = mergedLimits.dailyCostUsd ?? null;
      const resolved = await deps.resolveLimitRequest(
        id,
        'approved',
        requestUserId(req),
        grantedLimit,
      );
      if (!resolved) {
        return res.status(500).json({
          error: 'Limit was raised, but the request could not be marked approved; retry',
        });
      }

      const nameMap = await buildUserNameMap(deps.findUsers, [resolved.userId.toString()]);
      return res
        .status(200)
        .json({ request: toAdminLimitRequest(resolved, nameMap.get(resolved.userId.toString())) });
    } catch (error) {
      logger.error('[corporateLimitRequests] approveLimitRequest error:', error);
      return res.status(500).json({ error: 'Failed to approve limit request' });
    }
  }

  async function rejectLimitRequestHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid limit request ID format' });
      }

      if (scope.departmentId != null) {
        const lookup = await findRequestInScope(deps, id, scope.departmentId);
        if (!lookup.ok) {
          return lookup.reason === 'forbidden'
            ? res.status(403).json({ error: 'Forbidden' })
            : res.status(404).json({ error: 'Limit request not found' });
        }
      }

      const resolved = await deps.resolveLimitRequest(id, 'rejected', requestUserId(req));
      if (!resolved) {
        return res.status(404).json({ error: 'Limit request not found' });
      }

      const nameMap = await buildUserNameMap(deps.findUsers, [resolved.userId.toString()]);
      return res
        .status(200)
        .json({ request: toAdminLimitRequest(resolved, nameMap.get(resolved.userId.toString())) });
    } catch (error) {
      logger.error('[corporateLimitRequests] rejectLimitRequest error:', error);
      return res.status(500).json({ error: 'Failed to reject limit request' });
    }
  }

  return {
    listLimitRequests: listLimitRequestsHandler,
    approveLimitRequest: approveLimitRequestHandler,
    rejectLimitRequest: rejectLimitRequestHandler,
  };
}
