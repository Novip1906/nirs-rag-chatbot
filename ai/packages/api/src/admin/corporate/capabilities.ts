import { logger, SystemCapabilities } from '@librechat/data-schemas';
import type { IDepartment, SystemCapability } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { ResolvedPrincipal } from '~/types/principal';
import type { CallerDepartment } from './departmentScope';
import { requestUserId } from './context';

const ALL_BASE_CAPABILITIES: SystemCapability[] = Object.values(SystemCapabilities);

export interface MyCapabilitiesResponse {
  capabilities: string[];
  role: string;
  departmentId: string | null;
  /**
   * `GET /admin/departments` требует админ-уровня и главе всегда отвечает 403 — без
   * своего названия здесь глава не может узнать имя даже собственного отдела нигде
   * в интерфейсе. Здесь читать можно: `getDepartmentById` вызывается для того же
   * `departmentId`, что уже раскрыт этим же ответом, а не для чужого отдела.
   */
  departmentName: string | null;
}

export interface CorporateCapabilitiesDeps {
  getUserPrincipals: (params: {
    userId: string;
    role?: string | null;
    tenantId?: string;
  }) => Promise<ResolvedPrincipal[]>;
  getHeldCapabilities: (params: {
    principals: ResolvedPrincipal[];
    capabilities: SystemCapability[];
    tenantId?: string;
  }) => Promise<Set<SystemCapability>>;
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
  getDepartmentById: (id: string) => Promise<IDepartment | null>;
  /**
   * Принципалы вызывающего уже разрешены и закэшированы в рамках этого запроса:
   * маршрут стоит за `requireAdminAccess`, который вызывает `hasCapability` раньше
   * и кладёт результат в ALS-кэш. Без этого поля обработчик читал бы их из базы
   * заново — тот же приём, что в `admin/grants.ts`.
   */
  getCachedPrincipals?: (user: {
    id: string;
    role: string;
    tenantId?: string;
  }) => ResolvedPrincipal[] | undefined;
}

export function createCorporateCapabilitiesHandlers(deps: CorporateCapabilitiesDeps): {
  getMyCapabilities: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function resolvePrincipals(
    userId: string,
    role: string,
    tenantId: string | undefined,
  ): Promise<ResolvedPrincipal[]> {
    const cached = deps.getCachedPrincipals?.({ id: userId, role, tenantId });
    if (cached) {
      return cached;
    }
    return deps.getUserPrincipals({ userId, role, tenantId });
  }

  async function getMyCapabilitiesHandler(req: ServerRequest, res: Response) {
    try {
      const userId = requestUserId(req);
      const role = req.user?.role ?? '';
      const tenantId = (req.user as { tenantId?: string } | undefined)?.tenantId;

      const principals = await resolvePrincipals(userId, role, tenantId);

      const [held, policy] = await Promise.all([
        deps.getHeldCapabilities({ principals, capabilities: ALL_BASE_CAPABILITIES, tenantId }),
        deps.getUserPolicy(userId),
      ]);

      const departmentId = policy?.departmentId != null ? policy.departmentId.toString() : null;
      /**
       * Читается уже после `departmentId` — департамент зависит от политики, значит
       * распараллелить его с ней всё равно нельзя; но независимый от него `held` выше
       * уже идёт параллельно с чтением политики, так что лишнего последовательного шага
       * это не добавляет.
       */
      const department = departmentId != null ? await deps.getDepartmentById(departmentId) : null;

      const response: MyCapabilitiesResponse = {
        capabilities: Array.from(held),
        role,
        departmentId,
        departmentName: department?.name ?? null,
      };
      return res.status(200).json(response);
    } catch (error) {
      logger.error('[corporateCapabilities] getMyCapabilities error:', error);
      return res.status(500).json({ error: 'Failed to load capabilities' });
    }
  }

  return { getMyCapabilities: getMyCapabilitiesHandler };
}
