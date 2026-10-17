import type { AdminDepartment, AdminLimits } from '~/api';

export const EMPTY_LIMITS: AdminLimits = {
  dailyCostUsd: null,
};

/**
 * Что получит сотрудник, если личных значений у него нет. Зеркалит серверный каскад из
 * `packages/api/src/corporate/policy.ts`: отдел перекрывает глобальные настройки, но не
 * по одному полю — набор лимитов отдела действует целиком, ровно как персональный.
 *
 * Экран показывает эти значения прямо в полях, поэтому расхождение с сервером
 * означало бы, что админ сохраняет не то, что видит.
 */
export function inheritedLimits(
  department: AdminDepartment | undefined,
  globalDefaults: AdminLimits | undefined,
): AdminLimits {
  const source = department?.defaultLimits ?? globalDefaults;
  return { ...EMPTY_LIMITS, ...(source ?? {}) };
}

/**
 * Пустой список на любом уровне значит «здесь не настроено» и проваливается ниже — это
 * не запрет. Запрет — это `blocked`.
 */
export function inheritedModels(
  department: AdminDepartment | undefined,
  globalModels: string[] | undefined,
): string[] {
  if (department != null && department.allowedModels.length > 0) {
    return department.allowedModels;
  }
  return globalModels ?? [];
}

export function inheritedDefaultModel(
  department: AdminDepartment | undefined,
  globalDefault: string | null | undefined,
): string | null {
  if (department?.defaultModel != null) {
    return department.defaultModel;
  }
  return globalDefault ?? null;
}
