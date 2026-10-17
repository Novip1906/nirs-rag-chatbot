import { z } from 'zod';

export const DLP_CATEGORY_KEYS = [
  'secrets',
  'payment_card',
  'bank_account',
  'ru_inn',
  'ru_snils',
  'ru_passport',
] as const;

export type DlpCategoryKey = (typeof DLP_CATEGORY_KEYS)[number];

export const dlpCategoryModeSchema = z.enum(['mask', 'shadow', 'off']);

const categoriesShape = Object.fromEntries(
  DLP_CATEGORY_KEYS.map((key) => [key, dlpCategoryModeSchema.default('mask')]),
) as Record<DlpCategoryKey, z.ZodDefault<typeof dlpCategoryModeSchema>>;

export const dlpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maskEmbeddings: z.boolean().default(true),
  categories: z.object(categoriesShape).strict().default({}),
});

export type TDlpConfig = z.infer<typeof dlpConfigSchema>;

export const DEFAULT_DLP_CONFIG: TDlpConfig = dlpConfigSchema.parse({});
