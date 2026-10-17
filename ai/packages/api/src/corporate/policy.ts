export interface PolicyLimits {
  dailyCostUsd: number | null;
}

export interface ModelCapabilityFlags {
  knowledgeBase?: boolean;
  webSearch?: boolean;
  label?: string;
  description?: string;
}

export type ModelCapabilitiesMap = Record<string, ModelCapabilityFlags>;

export interface SettingsSource {
  systemPrompt: string;
  allowedModels: string[];
  defaultModel: string | null;
  defaultLimits: PolicyLimits;
  /**
   * Только у глобального `SettingsSource` (см. `resolvePolicy`) — департаментский и
   * пользовательский `SettingsSource`/`UserPolicySource` этим полем не пользуются:
   * какие инструменты модель может использовать — свойство модели, а не того, кто
   * её запрашивает.
   */
  modelCapabilities?: ModelCapabilitiesMap;
}

export interface UserPolicySource {
  departmentId: string | null;
  limits: Partial<PolicyLimits> | null;
  allowedModels: string[] | null;
  defaultModel: string | null;
  blocked: boolean;
}

export interface ResolvePolicyDeps {
  getGlobalSettings: () => Promise<SettingsSource>;
  getUserPolicy: (userId: string) => Promise<UserPolicySource | null>;
  getDepartmentById: (id: string) => Promise<SettingsSource | null>;
}

export interface EffectivePolicy {
  departmentId: string | null;
  limits: PolicyLimits;
  allowedModels: string[];
  defaultModel: string | null;
  systemPrompt: string;
  blocked: boolean;
  modelCapabilities: ModelCapabilitiesMap;
}

const LIMIT_KEYS: Array<keyof PolicyLimits> = ['dailyCostUsd'];

/**
 * База собирается по ключам, а не через `{ ...base }`: источники приходят из Mongoose,
 * где значения полей живут в прототипе документа, а собственных перечисляемых свойств у
 * него нет. Spread такого документа копировал бы служебные поля (`$__`, `_doc`) и терял
 * сами лимиты — глобальные значения по умолчанию молча не применялись бы ни к одному
 * пользователю, а в ответ API уходили бы внутренности Mongoose.
 */
export function mergeLimits(
  base: PolicyLimits,
  ...overrides: Array<Partial<PolicyLimits> | null | undefined>
): PolicyLimits {
  const merged = {} as PolicyLimits;
  for (const key of LIMIT_KEYS) {
    merged[key] = base?.[key] ?? null;
  }
  for (const override of overrides) {
    if (!override) {
      continue;
    }
    for (const key of LIMIT_KEYS) {
      const value = override[key];
      if (value != null) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Персональные лимиты — это «всё или ничего», а не пофайловое переопределение поверх
 * отдела: в кабинете ими управляет один переключатель «Личный лимит», и пустое поле там
 * означает «без ограничения», а не «взять из отдела». Пофайловый merge выразить это не
 * может — `null` в нём всегда читается как «унаследовать», и админ, снявший дневной
 * лимит, получил бы обратно лимит отдела.
 *
 * Поэтому наличие самого объекта `limits` решает, чей набор действует, а его поля берутся
 * как есть. Отсутствие объекта означает наследование целиком.
 */
/**
 * Exported so `approveLimitRequestHandler` (`admin/corporate/limitRequests.ts`) can compute
 * a target employee's currently-effective limits before merging an approved single-window
 * patch onto them — merging the patch onto empty defaults instead (as a naive partial
 * `$set` would) silently unlimits whichever window the approval didn't touch the moment a
 * personal limits object is created for the first time.
 */
export function resolveLimits(
  global: PolicyLimits,
  department: Partial<PolicyLimits> | null | undefined,
  user: Partial<PolicyLimits> | null | undefined,
): PolicyLimits {
  if (user == null) {
    return mergeLimits(global, department);
  }
  const resolved = {} as PolicyLimits;
  for (const key of LIMIT_KEYS) {
    resolved[key] = user[key] ?? null;
  }
  return resolved;
}

/**
 * An empty list at any level means "not configured here", not "nothing allowed" — it
 * cascades to the next level down (user → department → global) the same way a `null`
 * limit means "no threshold" rather than "zero". An empty result at every level is a
 * valid end state (no restriction anywhere ever set), not an implicit deny; blocking a
 * specific person is `blocked`'s job, not an empty `allowedModels`.
 */
function resolveModels(
  global: string[],
  department: string[] | null | undefined,
  user: string[] | null | undefined,
): string[] {
  if (user && user.length > 0) {
    return user;
  }
  if (department && department.length > 0) {
    return department;
  }
  return global;
}

/**
 * Кандидаты перебираются в том же порядке, что и список моделей (user → department →
 * global), но каждый проверяется на членство в уже посчитанном эффективном списке: уровень,
 * переопределивший список, мог не задать свой дефолт, и унаследованная сверху модель тогда
 * оказалась бы недоступной. Непустой список без единого валидного кандидата резолвится в
 * первый элемент — это состояние записей, созданных до появления поля. Пустой список значит
 * «ограничений нет», выбирать не из чего, и `null` отдаёт решение `default: true` из
 * librechat.yaml.
 */
function resolveDefaultModel(
  allowedModels: string[],
  candidates: Array<string | null | undefined>,
): string | null {
  if (allowedModels.length === 0) {
    return candidates.find((candidate) => candidate != null && candidate !== '') ?? null;
  }
  const allowed = new Set(allowedModels);
  for (const candidate of candidates) {
    if (candidate && allowed.has(candidate)) {
      return candidate;
    }
  }
  return allowedModels[0];
}

export async function resolvePolicy(
  deps: ResolvePolicyDeps,
  userId: string,
): Promise<EffectivePolicy> {
  const [global, userPolicy] = await Promise.all([
    deps.getGlobalSettings(),
    deps.getUserPolicy(userId),
  ]);

  const requestedDepartmentId = userPolicy?.departmentId ?? null;
  const department = requestedDepartmentId
    ? await deps.getDepartmentById(requestedDepartmentId)
    : null;

  const allowedModels = resolveModels(
    global.allowedModels,
    department?.allowedModels,
    userPolicy?.allowedModels,
  );

  return {
    departmentId: department ? requestedDepartmentId : null,
    limits: resolveLimits(global.defaultLimits, department?.defaultLimits, userPolicy?.limits),
    allowedModels,
    defaultModel: resolveDefaultModel(allowedModels, [
      userPolicy?.defaultModel,
      department?.defaultModel,
      global.defaultModel,
    ]),
    systemPrompt: [global.systemPrompt, department?.systemPrompt].filter(Boolean).join('\n\n'),
    blocked: userPolicy?.blocked ?? false,
    modelCapabilities: global.modelCapabilities ?? {},
  };
}
