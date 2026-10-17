import { isAdminLevelRole, SystemRoles } from 'librechat-data-provider';
import type { Types } from 'mongoose';

export type DepartmentScope =
  | { ok: true; departmentId: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Единственное место, где решается «чьи данные видно». Обработчики обязаны звать его,
 * а не сверять роль сами: пропущенная проверка в одном обработчике открывает главе
 * чужой отдел, и заметить это по коду соседних маршрутов невозможно.
 */
export function resolveDepartmentScope(input: {
  role: string;
  departmentId: string | null;
}): DepartmentScope {
  if (isAdminLevelRole(input.role)) {
    return { ok: true, departmentId: null };
  }
  if (input.role !== SystemRoles.HEAD) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (input.departmentId == null) {
    return { ok: false, status: 400, error: 'A department head must belong to a department' };
  }
  return { ok: true, departmentId: input.departmentId };
}

/**
 * Отдел вызывающего, каким его видит `resolveDepartmentScope`. Тип структурный, а не
 * `IUserPolicy` целиком — обработчику не нужен весь документ политики ради одного поля,
 * и это даёт каждому модулю зависимостей объявить `getUserPolicy` в своей собственной,
 * более узкой форме.
 */
export interface CallerDepartment {
  departmentId?: Types.ObjectId | string | null;
}

export interface DepartmentScopeDeps {
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
}

/**
 * Обёртка `resolveDepartmentScope` для запроса: у админ-уровневых ролей отдел решает
 * `isAdminLevelRole` раньше, чем понадобится чтение из базы, поэтому политика
 * вызывающего читается ровно один раз за запрос и только для главы — не для каждой
 * роли подряд.
 */
export async function resolveRequestDepartmentScope(
  deps: DepartmentScopeDeps,
  role: string,
  callerId: string,
): Promise<DepartmentScope> {
  if (role !== SystemRoles.HEAD) {
    return resolveDepartmentScope({ role, departmentId: null });
  }
  const policy = await deps.getUserPolicy(callerId);
  const departmentId = policy?.departmentId != null ? policy.departmentId.toString() : null;
  return resolveDepartmentScope({ role, departmentId });
}
