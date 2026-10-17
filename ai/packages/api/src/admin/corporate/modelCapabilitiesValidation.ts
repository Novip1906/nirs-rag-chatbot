import type { ModelCapabilitiesMap, IModelCapabilityFlags } from '@librechat/data-schemas';

type CapabilityFlagKey = 'knowledgeBase' | 'webSearch';
type OverrideTextKey = 'label' | 'description';

const CAPABILITY_FLAG_KEYS: CapabilityFlagKey[] = ['knowledgeBase', 'webSearch'];
const OVERRIDE_TEXT_KEYS: OverrideTextKey[] = ['label', 'description'];

const OVERRIDE_MAX_LENGTHS: Record<OverrideTextKey, number> = {
  label: 80,
  description: 300,
};

const OVERRIDE_FIELD_NAMES_RU: Record<OverrideTextKey, string> = {
  label: 'Название',
  description: 'Описание',
};

export type ModelCapabilitiesValidation =
  | { ok: true; capabilities: ModelCapabilitiesMap }
  | { ok: false; error: string };

function isCapabilityFlagKey(key: string): key is CapabilityFlagKey {
  return (CAPABILITY_FLAG_KEYS as string[]).includes(key);
}

function isOverrideTextKey(key: string): key is OverrideTextKey {
  return (OVERRIDE_TEXT_KEYS as string[]).includes(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Приводит присланное к парам «модель → настройки», принимая обе формы: список записей
 * с `modelId` внутри (так шлёт админка) и объект-карту (прежняя форма, остаётся ради
 * совместимости и прямых обращений к API).
 *
 * Список появился не от любви к спискам: защита от инъекций в запросах
 * (`express-mongo-sanitize`) вырезает из тела ключи с точкой, а точка есть почти в каждом
 * идентификаторе модели — `gpt-5.6-luna`, `gemini-3.7-flash`, `claude-haiku-4.5`. Пока
 * идентификатор ехал ключом объекта, настройки таких моделей молча пропадали по дороге:
 * сохранялись только модели без точки в имени.
 */
function toEntries(value: unknown): Array<[string, unknown]> | null {
  if (Array.isArray(value)) {
    const entries: Array<[string, unknown]> = [];
    for (const item of value) {
      if (!isPlainObject(item)) {
        return null;
      }
      const { modelId, ...flags } = item;
      if (typeof modelId !== 'string') {
        return null;
      }
      entries.push([modelId, flags]);
    }
    return entries;
  }
  if (isPlainObject(value)) {
    return Object.entries(value);
  }
  return null;
}

/**
 * Validates the admin's `modelCapabilities` payload: model id → which tools
 * (`knowledgeBase`, `webSearch`) that model is allowed to use, plus optional `label`/
 * `description` overrides for what the employee sees in the model picker. Sent in full on
 * every save (see `updateGlobalSettings` — `Mixed` replaces wholesale, it doesn't merge),
 * so a malformed single entry must reject the whole request rather than silently drop it
 * and desync the admin's screen from what got saved.
 */
export function validateModelCapabilities(value: unknown): ModelCapabilitiesValidation {
  const entries = toEntries(value);
  if (entries == null) {
    return { ok: false, error: 'modelCapabilities must be an object or a list of entries' };
  }

  const capabilities: ModelCapabilitiesMap = {};
  for (const [modelId, raw] of entries) {
    if (modelId.trim() === '') {
      return { ok: false, error: 'modelCapabilities keys must be non-empty model ids' };
    }
    if (!isPlainObject(raw)) {
      return { ok: false, error: `modelCapabilities["${modelId}"] must be an object` };
    }

    const flags: IModelCapabilityFlags = {};
    for (const [key, fieldValue] of Object.entries(raw)) {
      if (isCapabilityFlagKey(key)) {
        if (typeof fieldValue !== 'boolean') {
          return { ok: false, error: `${key} must be a boolean` };
        }
        flags[key] = fieldValue;
        continue;
      }

      if (isOverrideTextKey(key)) {
        if (typeof fieldValue !== 'string') {
          return { ok: false, error: `${key} must be a string` };
        }
        const trimmed = fieldValue.trim();
        /** Пустая строка — «нет переопределения»: поле не сохраняется, а не хранится пустым. */
        if (trimmed === '') {
          continue;
        }
        if (trimmed.length > OVERRIDE_MAX_LENGTHS[key]) {
          return {
            ok: false,
            error: `${OVERRIDE_FIELD_NAMES_RU[key]} модели "${modelId}" не должно превышать ${OVERRIDE_MAX_LENGTHS[key]} символов`,
          };
        }
        flags[key] = trimmed;
        continue;
      }

      return { ok: false, error: `Unknown capability field: ${key}` };
    }
    capabilities[modelId] = flags;
  }

  return { ok: true, capabilities };
}
