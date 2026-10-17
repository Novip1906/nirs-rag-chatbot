export interface ModelSelectionInput {
  allowedModels?: string[] | null;
  defaultModel?: string | null;
}

export interface ModelSelectionCurrent {
  allowedModels: string[] | null;
  defaultModel: string | null;
}

export interface ModelSelectionFields {
  allowedModels?: string[] | null;
  defaultModel?: string | null;
}

export type ModelSelectionValidation =
  | { ok: true; fields: ModelSelectionFields }
  | { ok: false; error: string };

function isModelList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
  );
}

/**
 * Проверяет пару «разрешённые модели + модель по умолчанию» против сливаемого состояния,
 * а не только против тела запроса: обновления частичные, и PATCH одного поля иначе
 * оставил бы дефолт вне списка. Обязательность условная — дефолт требуется ровно тогда,
 * когда список непустой; пустой список значит «ограничений нет», выбирать не из чего, и
 * дефолт очищается сам, а не отвергает запрос.
 *
 * Возвращает только те поля, которые вызывающему коду действительно нужно записать, —
 * `undefined` сохраняет частичную семантику апдейта.
 */
export function validateModelSelection(
  input: ModelSelectionInput,
  current: ModelSelectionCurrent,
): ModelSelectionValidation {
  if (input.allowedModels === undefined && input.defaultModel === undefined) {
    return { ok: true, fields: {} };
  }

  if (
    input.allowedModels !== undefined &&
    input.allowedModels !== null &&
    !isModelList(input.allowedModels)
  ) {
    return { ok: false, error: 'allowedModels must be an array of non-empty strings' };
  }

  if (
    input.defaultModel !== undefined &&
    input.defaultModel !== null &&
    typeof input.defaultModel !== 'string'
  ) {
    return { ok: false, error: 'defaultModel must be a string or null' };
  }

  const nextAllowed =
    input.allowedModels !== undefined ? input.allowedModels : current.allowedModels;
  const rawDefault = input.defaultModel !== undefined ? input.defaultModel : current.defaultModel;
  const nextDefault =
    typeof rawDefault === 'string' && rawDefault.trim() !== '' ? rawDefault : null;

  const fields: ModelSelectionFields = {};
  if (input.allowedModels !== undefined) {
    fields.allowedModels = input.allowedModels;
  }

  if (nextAllowed == null || nextAllowed.length === 0) {
    fields.defaultModel = null;
    return { ok: true, fields };
  }

  if (nextDefault == null) {
    return { ok: false, error: 'defaultModel is required when allowedModels is not empty' };
  }

  if (!nextAllowed.includes(nextDefault)) {
    return { ok: false, error: 'defaultModel must be one of allowedModels' };
  }

  fields.defaultModel = nextDefault;
  return { ok: true, fields };
}
