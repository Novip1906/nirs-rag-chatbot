import { logger } from '@librechat/data-schemas';
import type { AdminModelOption } from 'librechat-data-provider';
import type { ICorporateSettings, IDepartment, IUserPolicy } from '@librechat/data-schemas';
import type { ResolveModelSpecFn } from '~/agents/modelSpec';
import type { ResolvePolicyDeps, SettingsSource, UserPolicySource } from './policy';
import { filterModelSpecsForUser } from './modelFilter';
import { resolvePolicy } from './policy';

type SettingsFields = Pick<
  ICorporateSettings,
  'systemPrompt' | 'allowedModels' | 'defaultModel' | 'defaultLimits'
> &
  Partial<Pick<ICorporateSettings, 'modelCapabilities'>>;
/**
 * `canUploadKnowledge` в `Partial` намеренно, а не в основном `Pick`: резолвер
 * политики (`toUserPolicySource`) этим полем не пользуется, его читает только
 * админский обработчик через `referencePolicy?.canUploadKnowledge`. Обязательное
 * поле заставило бы проставлять его во всех фикстурах, которым оно не нужно.
 */
type UserPolicyFields = Pick<
  IUserPolicy,
  'departmentId' | 'limits' | 'allowedModels' | 'defaultModel' | 'blocked'
> &
  Partial<Pick<IUserPolicy, 'canUploadKnowledge'>>;
type DepartmentFields = Pick<
  IDepartment,
  'systemPrompt' | 'allowedModels' | 'defaultModel' | 'defaultLimits'
>;

/**
 * Deliberately narrower than the full Mongoose `Document` types — the adapter only
 * ever reads these fields, so it neither needs nor should require a real Document
 * (letting call sites and tests pass plain objects; a real `ICorporateSettings` etc.
 * is still assignable here since it's a structural superset).
 */
export interface CorporatePolicyMethods {
  getGlobalSettings: () => Promise<SettingsFields>;
  getUserPolicy: (userId: string) => Promise<UserPolicyFields | null>;
  getDepartmentById: (id: string) => Promise<DepartmentFields | null>;
}

function toSettingsSource(settings: SettingsFields): SettingsSource {
  return {
    systemPrompt: settings.systemPrompt,
    allowedModels: settings.allowedModels,
    defaultModel: settings.defaultModel ?? null,
    defaultLimits: settings.defaultLimits,
    modelCapabilities: settings.modelCapabilities ?? {},
  };
}

function toUserPolicySource(policy: UserPolicyFields): UserPolicySource {
  return {
    departmentId: policy.departmentId ? policy.departmentId.toString() : null,
    limits: policy.limits ?? null,
    allowedModels: policy.allowedModels ?? null,
    defaultModel: policy.defaultModel ?? null,
    blocked: policy.blocked,
  };
}

function toDepartmentSettingsSource(department: DepartmentFields): SettingsSource {
  return {
    systemPrompt: department.systemPrompt ?? '',
    allowedModels: department.allowedModels,
    defaultModel: department.defaultModel ?? null,
    defaultLimits: department.defaultLimits,
  };
}

/**
 * Bridges the Mongoose-shaped `IUserPolicy`/`IDepartment`/`ICorporateSettings` documents
 * (`ObjectId` refs, optional fields defaulted by the schema) onto `ResolvePolicyDeps`'
 * plain-value contract (`string` ids, required fields) that `resolvePolicy` consumes.
 */
export function toResolvePolicyDeps(methods: CorporatePolicyMethods): ResolvePolicyDeps {
  return {
    getGlobalSettings: () => methods.getGlobalSettings().then(toSettingsSource),
    getUserPolicy: (userId) =>
      methods.getUserPolicy(userId).then((policy) => (policy ? toUserPolicySource(policy) : null)),
    getDepartmentById: (id) =>
      methods
        .getDepartmentById(id)
        .then((department) => (department ? toDepartmentSettingsSource(department) : null)),
  };
}

/**
 * One-shot department lookup for billing call sites (abort, public
 * `/api/agents/v1/*` routes, detached subagents) that don't already have a
 * memoized policy resolution in hand. Never throws — a resolution failure
 * must not block token/USD billing, only fall back to `null` (ruble ledger
 * row still gets written, just without a department).
 */
export async function resolveDepartmentId(
  methods: CorporatePolicyMethods,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) {
    return null;
  }
  try {
    const policy = await resolvePolicy(toResolvePolicyDeps(methods), userId);
    return policy.departmentId;
  } catch (err) {
    logger.error('[resolveDepartmentId] Failed to resolve Corporate AI policy', err);
    return null;
  }
}

/**
 * One-shot system prompt lookup for agent loading, which has no memoized policy
 * resolution in hand. Never throws — a resolution failure must not block the chat
 * turn, only fall back to `''` (no system prompt, same as before this existed).
 */
export async function resolveSystemPrompt(
  methods: CorporatePolicyMethods,
  userId: string | null | undefined,
): Promise<string> {
  if (!userId) {
    return '';
  }
  try {
    const policy = await resolvePolicy(toResolvePolicyDeps(methods), userId);
    return policy.systemPrompt;
  } catch (err) {
    logger.error('[resolveSystemPrompt] Failed to resolve Corporate AI policy', err);
    return '';
  }
}

/**
 * Adapts the Mongoose-shaped Corporate AI policy methods into a `ResolveModelSpecFn`
 * (см. `agents/modelSpec.ts`) для загрузки агента: `filterModelSpecsForUser` строит тот же
 * эффективный список спеков, что видит клиентский пикер моделей и что проверяет
 * `buildEndpointOption.js` в enforce-режиме, — так что синтетический спек для модели,
 * разрешённой политикой, но не заведённой в librechat.yaml, находится здесь так же, как
 * и везде, где до этого доходил только сырой `modelSpecs.list`. Никогда не бросает —
 * ошибка резолва должна просто оставить агента без спека (как и раньше), а не сорвать ход.
 */
export function toResolveModelSpecFn(
  methods: CorporatePolicyMethods,
  getCatalogModels?: () => Promise<AdminModelOption[]>,
): ResolveModelSpecFn {
  return async (userId, modelSpecsList, specName) => {
    try {
      const effective = await filterModelSpecsForUser(
        {
          resolvePolicy: (id) => resolvePolicy(toResolvePolicyDeps(methods), id),
          getCatalogModels,
        },
        userId,
        { list: modelSpecsList, enforce: false },
      );
      return effective?.list?.find((s) => s.name === specName) ?? null;
    } catch (err) {
      logger.error('[toResolveModelSpecFn] Failed to resolve effective model spec', err);
      return null;
    }
  };
}
