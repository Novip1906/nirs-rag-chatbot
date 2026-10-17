export enum SystemRoles {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  HEAD = 'HEAD',
  USER = 'USER',
}

/**
 * `HEAD` намеренно не входит сюда: эта константа отвечает за полный админский доступ
 * (сидинг всех capability и проверка `checkAdmin`), а глава отдела получает только
 * узкий набор полномочий своей роли.
 */
export const ADMIN_LEVEL_ROLES: readonly string[] = [SystemRoles.OWNER, SystemRoles.ADMIN];

const adminLevelRoleSet = new Set<string>(ADMIN_LEVEL_ROLES);

export function isAdminLevelRole(role: string | undefined | null): boolean {
  return role != null && adminLevelRoleSet.has(role);
}

const assignableRolesByActor: Record<string, readonly string[]> = {
  [SystemRoles.OWNER]: [SystemRoles.OWNER, SystemRoles.ADMIN, SystemRoles.HEAD, SystemRoles.USER],
  [SystemRoles.ADMIN]: [SystemRoles.ADMIN, SystemRoles.HEAD, SystemRoles.USER],
  [SystemRoles.USER]: [],
};

export function assignableRoles(actorRole: string | undefined | null): readonly string[] {
  if (actorRole == null) {
    return [];
  }
  return assignableRolesByActor[actorRole] ?? [];
}
