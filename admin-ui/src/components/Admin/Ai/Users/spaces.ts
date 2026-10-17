import type { KnowledgeSpaceItem } from '~/api';

export interface SpaceOptions {
  /** Пространства, которых отдел не даёт: их и предлагаем открыть дополнительно. */
  additional: KnowledgeSpaceItem[];
  /** Пространства, доступные по отделу: только их и есть смысл закрывать. */
  blockable: KnowledgeSpaceItem[];
}

function isGrantedByDepartment(space: KnowledgeSpaceItem, departmentId: string | null): boolean {
  if (space.allowedDepartments.length === 0) {
    return true;
  }
  return departmentId != null && space.allowedDepartments.includes(departmentId);
}

/**
 * Два списка не пересекаются: пространство, которое сотрудник и так получает по отделу,
 * незачем предлагать в дополнительном доступе, а то, чего у него нет, — незачем закрывать.
 * Выключенные пространства не показываются нигде: они недоступны никому, и появление их
 * в списках выглядело бы как выданный доступ, которого на самом деле нет.
 */
export function splitSpaceOptions(
  spaces: KnowledgeSpaceItem[],
  departmentId: string | null,
): SpaceOptions {
  const additional: KnowledgeSpaceItem[] = [];
  const blockable: KnowledgeSpaceItem[] = [];

  for (const space of spaces) {
    if (!space.enabled) {
      continue;
    }
    if (isGrantedByDepartment(space, departmentId)) {
      blockable.push(space);
      continue;
    }
    additional.push(space);
  }

  return { additional, blockable };
}

/**
 * Смена отдела может сделать персональную выдачу лишней — новый отдел уже даёт то же
 * пространство. Такие идентификаторы убираются из выбора, иначе в базе накапливались бы
 * выдачи-дубликаты, ничего не меняющие, но переживающие следующий переезд сотрудника.
 */
export function pruneRedundantGrants(
  allowedSpaces: string[],
  spaces: KnowledgeSpaceItem[],
  departmentId: string | null,
): string[] {
  const redundant = new Set(
    spaces.filter((space) => isGrantedByDepartment(space, departmentId)).map((space) => space.id),
  );
  return allowedSpaces.filter((id) => !redundant.has(id));
}
