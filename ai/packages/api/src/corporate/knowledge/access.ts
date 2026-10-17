import { isAdminLevelRole, SystemRoles } from 'librechat-data-provider';

export interface KnowledgeSpaceSource {
  id: string;
  name: string;
  allowedDepartments: string[];
  enabled: boolean;
}

export interface SpaceOverrides {
  allowedSpaces: string[];
  deniedSpaces: string[];
}

export interface KnowledgeAccessDeps {
  resolvePolicy: (
    userId: string,
  ) => Promise<{ departmentId: string | null; blocked: boolean; role?: string }>;
  listSpaces: () => Promise<KnowledgeSpaceSource[]>;
  getSpaceOverrides: (userId: string) => Promise<SpaceOverrides>;
}

/**
 * Порядок проверок значим: `enabled` и `denied` отсекаются первыми, поэтому
 * персональное разрешение не может воскресить выключенное или запрещённое
 * пространство. Ошибка настройки приводит к отказу в доступе, а не к утечке.
 *
 * Админ-уровневые роли читают всё включённое — симметрично `resolveWritableSpaces`,
 * которая открывает им запись в любое пространство. Без этого админ загружал документ
 * в пространство чужого отдела и переставал его видеть: и в списке, и в поиске.
 */
export async function resolveAllowedSpaces(
  deps: KnowledgeAccessDeps,
  userId: string,
): Promise<KnowledgeSpaceSource[]> {
  const [policy, spaces, overrides] = await Promise.all([
    deps.resolvePolicy(userId),
    deps.listSpaces(),
    deps.getSpaceOverrides(userId),
  ]);

  if (policy.blocked) {
    return [];
  }

  const granted = new Set(overrides.allowedSpaces);
  const denied = new Set(overrides.deniedSpaces);

  return spaces.filter((space) => {
    if (!space.enabled || denied.has(space.id)) {
      return false;
    }
    if (isAdminLevelRole(policy.role)) {
      return true;
    }
    if (space.allowedDepartments.length === 0) {
      return true;
    }
    if (policy.departmentId != null && space.allowedDepartments.includes(policy.departmentId)) {
      return true;
    }
    return granted.has(space.id);
  });
}

export interface KnowledgeWriteAccessDeps {
  resolveWritePolicy: (userId: string) => Promise<{
    departmentId: string | null;
    blocked: boolean;
    role: string;
    canUploadKnowledge: boolean;
  }>;
  listSpaces: () => Promise<KnowledgeSpaceSource[]>;
  getSpaceOverrides: (userId: string) => Promise<SpaceOverrides>;
}

/**
 * Право записи считается отдельно от права чтения и намеренно строже.
 *
 * Пустой `allowedDepartments` означает «пространство доступно всем на чтение»
 * (см. `resolveAllowedSpaces`). На запись такое пространство не открывается никому,
 * кроме админа: иначе любой сотрудник с галочкой писал бы в общекорпоративную базу.
 *
 * Персональные `allowedSpaces` тоже не дают записи — это разрешение читать чужое
 * пространство, а не пополнять его. Персональный запрет `deniedSpaces` сильнее
 * роли и действует даже на админ-уровневые роли — как и в `resolveAllowedSpaces`.
 */
export async function resolveWritableSpaces(
  deps: KnowledgeWriteAccessDeps,
  userId: string,
): Promise<KnowledgeSpaceSource[]> {
  const [policy, spaces, overrides] = await Promise.all([
    deps.resolveWritePolicy(userId),
    deps.listSpaces(),
    deps.getSpaceOverrides(userId),
  ]);

  if (policy.blocked) {
    return [];
  }

  const denied = new Set(overrides.deniedSpaces);
  const enabled = spaces.filter((space) => space.enabled && !denied.has(space.id));
  if (isAdminLevelRole(policy.role)) {
    return enabled;
  }

  const isHead = policy.role === SystemRoles.HEAD;
  if (!isHead && !policy.canUploadKnowledge) {
    return [];
  }

  const departmentId = policy.departmentId;
  if (departmentId == null) {
    return [];
  }

  return enabled.filter((space) => space.allowedDepartments.includes(departmentId));
}
