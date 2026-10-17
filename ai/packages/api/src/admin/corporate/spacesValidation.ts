export interface SpaceOverridesInput {
  allowedSpaces?: string[];
  deniedSpaces?: string[];
}

export interface SpaceOverridesFields {
  allowedSpaces?: string[];
  deniedSpaces?: string[];
}

export type SpaceOverridesValidation =
  | { ok: true; fields: SpaceOverridesFields }
  | { ok: false; error: string };

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateIds(
  ids: unknown,
  fieldName: string,
  knownSpaceIds: Set<string>,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!isStringList(ids)) {
    return { ok: false, error: `${fieldName} must be an array of strings` };
  }
  const unknown = ids.find((id) => !knownSpaceIds.has(id));
  if (unknown !== undefined) {
    return { ok: false, error: `Unknown knowledge space id in ${fieldName}: ${unknown}` };
  }
  return { ok: true, ids };
}

/**
 * Проверяет персональный оверрайд прав на пространства базы знаний (design §5):
 * `allowedSpaces` добавляет пространства сверх отдела, `deniedSpaces` их отнимает.
 * Каждый id обязан ссылаться на реально существующее пространство — иначе сохранился
 * бы мусор, который `resolveAllowedSpaces` затем либо тихо игнорирует (для
 * `allowedSpaces`), либо не удастся объяснить админу постфактум (для `deniedSpaces`).
 * `knownSpaceIds` передаётся вызывающей стороной, чтобы эта функция оставалась чистой
 * и не знала про Mongo.
 */
export function validateSpaceOverrides(
  input: SpaceOverridesInput,
  knownSpaceIds: Set<string>,
): SpaceOverridesValidation {
  const fields: SpaceOverridesFields = {};

  if (input.allowedSpaces !== undefined) {
    const validated = validateIds(input.allowedSpaces, 'allowedSpaces', knownSpaceIds);
    if (!validated.ok) {
      return validated;
    }
    fields.allowedSpaces = validated.ids;
  }

  if (input.deniedSpaces !== undefined) {
    const validated = validateIds(input.deniedSpaces, 'deniedSpaces', knownSpaceIds);
    if (!validated.ok) {
      return validated;
    }
    fields.deniedSpaces = validated.ids;
  }

  return { ok: true, fields };
}

export type HeadSpaceDepartmentsValidation =
  | { ok: true; allowedDepartments: string[] }
  | { ok: false; error: string };

/**
 * Глава может создавать и редактировать пространства базы знаний только в границах
 * своего отдела: `allowedDepartments` обязано быть ровно `[headDepartmentId]`, не
 * пустым списком (= видно всем) и не расширенным на другие отделы. Отсутствие поля
 * в запросе на создание трактуется как «моё пространство» и подставляется само; для
 * правки вызывающая сторона зовёт эту функцию, только когда `allowedDepartments`
 * явно передан — необновляемое поле сюда не попадает.
 */
export function resolveHeadSpaceDepartments(
  allowedDepartments: string[] | undefined,
  headDepartmentId: string,
): HeadSpaceDepartmentsValidation {
  if (allowedDepartments === undefined) {
    return { ok: true, allowedDepartments: [headDepartmentId] };
  }
  if (allowedDepartments.length !== 1 || allowedDepartments[0] !== headDepartmentId) {
    return {
      ok: false,
      error: 'Department heads may only scope knowledge spaces to their own department',
    };
  }
  return { ok: true, allowedDepartments };
}
