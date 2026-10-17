import type { AdminModelInputModality, AdminModelOption, AdminModelPricing } from '~/api';
import type { LocalizeOptions, TranslationKeys } from '~/hooks/useLocalize';

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
};

function currencySymbol(currency: string | null | undefined): string {
  if (currency == null) {
    return '';
  }
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

/** Провайдер отдаёт цены с 5-6 знаками после запятой (`17.83305000`) — для человека
 *  это шум, одного знака достаточно, а лишний ноль после округления не показываем. */
function formatAmount(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

type Localize = (key: TranslationKeys, options?: LocalizeOptions) => string;

/**
 * Цена входа и выхода в одной строке для карточки списка — заказчик настоял на паре,
 * а не на одной цифре: у части моделей выход дороже входа в 5-6 раз, и по одному
 * числу нельзя оценить реальную стоимость диалога. Валюта — как прислал провайдер
 * (у polza всегда рубли), без пересчёта: админ считает бюджет в рублях.
 */
export function formatModelPriceRow(
  pricing: AdminModelPricing | null | undefined,
  localize: Localize,
): string {
  if (pricing?.promptPerMillion == null || pricing?.completionPerMillion == null) {
    return localize('com_admin_allowed_models_price_missing');
  }
  return localize('com_admin_allowed_models_price_row', {
    prompt: formatAmount(pricing.promptPerMillion),
    completion: formatAmount(pricing.completionPerMillion),
    currency: currencySymbol(pricing.currency),
  });
}

interface PriceField {
  key: Exclude<keyof AdminModelPricing, 'currency'>;
  labelKey: TranslationKeys;
  unitKey: TranslationKeys;
}

const PRICE_FIELDS: PriceField[] = [
  {
    key: 'promptPerMillion',
    labelKey: 'com_admin_model_details_price_prompt',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
  {
    key: 'completionPerMillion',
    labelKey: 'com_admin_model_details_price_completion',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
  {
    key: 'imageInputPerMillion',
    labelKey: 'com_admin_model_details_price_image_input',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
  {
    key: 'audioPerMillion',
    labelKey: 'com_admin_model_details_price_audio',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
  {
    key: 'webSearchPerThousand',
    labelKey: 'com_admin_model_details_price_web_search',
    unitKey: 'com_admin_model_details_unit_per_thousand',
  },
  {
    key: 'inputCacheReadPerMillion',
    labelKey: 'com_admin_model_details_price_cache_read',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
  {
    key: 'inputCacheWritePerMillion',
    labelKey: 'com_admin_model_details_price_cache_write',
    unitKey: 'com_admin_model_details_unit_per_million',
  },
];

export interface PricingDetailRow {
  label: string;
  value: string;
}

/**
 * Полный прайс для модалки — семь полей, которые провайдер отдаёт не для каждой
 * модели (цена за аудио есть не у всех, за кэш — почти ни у кого). Отсутствующее
 * поле показывается как «цена не указана», а не нулём — ноль читался бы как
 * «бесплатно».
 */
export function buildPricingDetails(
  pricing: AdminModelPricing | null | undefined,
  localize: Localize,
): PricingDetailRow[] {
  return PRICE_FIELDS.map(({ key, labelKey, unitKey }) => {
    const raw = pricing?.[key] ?? null;
    const value =
      raw == null
        ? localize('com_admin_allowed_models_price_missing')
        : `${formatAmount(raw)} ${currencySymbol(pricing?.currency)} ${localize(unitKey)}`;
    return { label: localize(labelKey), value };
  });
}

export function formatContextLength(
  contextLength: number | null | undefined,
  localize: Localize,
): string {
  if (contextLength == null) {
    return localize('com_admin_model_details_context_missing');
  }
  return localize('com_admin_allowed_models_meta_context', {
    count: contextLength.toLocaleString('ru-RU'),
  });
}

const MODALITY_LABEL_KEYS: Record<AdminModelInputModality, TranslationKeys> = {
  text: 'com_admin_allowed_models_modality_text',
  image: 'com_admin_allowed_models_modality_image',
  file: 'com_admin_allowed_models_modality_file',
  audio: 'com_admin_allowed_models_modality_audio',
  video: 'com_admin_allowed_models_modality_video',
};

/** Все принимаемые типы для модалки, включая текст — в отличие от строки списка,
 *  где для текста бейджа нет (это база для чат-модели, а не отличительный признак). */
export function buildAllModalityLabels(
  model: Pick<AdminModelOption, 'inputModalities'>,
  localize: Localize,
): string[] {
  return (model.inputModalities ?? []).map((modality) => localize(MODALITY_LABEL_KEYS[modality]));
}

export interface RowModalityFlags {
  image: boolean;
  file: boolean;
}

/**
 * Только картинки и файлы — заказчик просил именно эти два значка в строке списка
 * (аудио/видео редки среди чат-моделей и не стоят места в компактной карточке);
 * полный список модальностей — в модалке (`buildAllModalityLabels`).
 */
export function getRowModalityFlags(
  model: Pick<AdminModelOption, 'inputModalities'>,
): RowModalityFlags {
  const modalities = model.inputModalities ?? [];
  return { image: modalities.includes('image'), file: modalities.includes('file') };
}
