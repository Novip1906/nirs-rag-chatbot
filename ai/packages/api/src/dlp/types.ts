export const DLP_CATEGORIES = [
  'secrets',
  'payment_card',
  'bank_account',
  'ru_inn',
  'ru_snils',
  'ru_passport',
] as const;
export type DlpCategory = (typeof DLP_CATEGORIES)[number];
export type DlpCategoryMode = 'mask' | 'shadow' | 'off';

export interface DlpMatch {
  readonly category: DlpCategory;
  /** Смещения в ИСХОДНОЙ строке. */
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

export interface DlpDetectOptions {
  readonly modes: Readonly<Record<DlpCategory, DlpCategoryMode>>;
}
