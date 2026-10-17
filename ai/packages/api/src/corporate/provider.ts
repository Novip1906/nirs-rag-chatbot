import { logger } from '@librechat/data-schemas';
import type { TSpecsConfig } from 'librechat-data-provider';

export type AiProviderId = 'openrouter' | 'polza';

export type AiProviderCurrency = 'USD' | 'RUB';

export type UsageCostField = 'cost' | 'cost_rub';

export interface AiProvider {
  id: AiProviderId;
  /** Имя эндпоинта в `librechat.yaml`; оно же записано в поле `endpoint` бесед. */
  endpointName: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** Валюта, в которой провайдер отдаёт и стоимость вызова, и остаток на счету. */
  currency: AiProviderCurrency;
  /** Поля `usage`, откуда берётся стоимость вызова, в порядке предпочтения. */
  usageCostFields: readonly UsageCostField[];
  balancePath: string;
  parseBalance: (payload: unknown) => number | null;
}

/**
 * Курс на 2026-08-29 по ЦБ. Учёт расходов ведётся в долларах, а polza считает
 * в рублях: без пересчёта её рубли попали бы в журнал как доллары. Курс
 * переопределяется переменной `RUB_PER_USD` — правка ConfigMap дешевле пересборки
 * образа, а образ здесь собирается вручную.
 */
export const DEFAULT_RUB_PER_USD = 85.6;

/**
 * Подставляется вместо `preset.endpoint` у каждой спеки при загрузке конфига
 * (см. {@link applyActiveAiEndpoint}). Не переменная окружения: имя активного
 * эндпоинта выводится из `AI_PROVIDER`, чтобы две настройки не разъехались.
 */
export const ACTIVE_ENDPOINT_PLACEHOLDER = '${AI_ACTIVE_ENDPOINT}';

const DEFAULT_PROVIDER_ID: AiProviderId = 'openrouter';

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const raw = source[key];
  const parsed = typeof raw === 'string' ? Number(raw) : raw;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload != null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : null;
}

function parseOpenRouterCredits(payload: unknown): number | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (data == null) {
    return null;
  }
  const total = readNumber(data, 'total_credits');
  const used = readNumber(data, 'total_usage');
  if (total == null || used == null) {
    return null;
  }
  return total - used;
}

function parsePolzaBalance(payload: unknown): number | null {
  const root = asRecord(payload);
  return root == null ? null : readNumber(root, 'amount');
}

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  openrouter: {
    id: 'openrouter',
    endpointName: 'OpenRouter',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    currency: 'USD',
    usageCostFields: ['cost'],
    balancePath: '/credits',
    parseBalance: parseOpenRouterCredits,
  },
  polza: {
    id: 'polza',
    endpointName: 'Corporate AI',
    baseUrlEnv: 'AI_BASE_URL',
    apiKeyEnv: 'AI_API_KEY',
    currency: 'RUB',
    /** polza отдаёт и `cost_rub`, и `cost`, но оба — в рублях: читать у неё
     *  `cost` как доллары значило бы завысить расход примерно в 86 раз. */
    usageCostFields: ['cost_rub', 'cost'],
    balancePath: '/balance',
    parseBalance: parsePolzaBalance,
  },
};

const warnedOnce = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) {
    return;
  }
  warnedOnce.add(key);
  logger.warn(message);
}

export function getRubPerUsd(): number {
  const raw = process.env.RUB_PER_USD?.trim();
  if (!raw) {
    return DEFAULT_RUB_PER_USD;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warnOnce(
      `rate:${raw}`,
      `[aiProvider] RUB_PER_USD ("${raw}") не число больше нуля — берётся ${DEFAULT_RUB_PER_USD}.`,
    );
    return DEFAULT_RUB_PER_USD;
  }
  return parsed;
}

export function convertToUsd(amount: number, currency: AiProviderCurrency): number {
  return currency === 'USD' ? amount : amount / getRubPerUsd();
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
}

export function getActiveProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!raw) {
    return AI_PROVIDERS[DEFAULT_PROVIDER_ID];
  }
  if (!isAiProviderId(raw)) {
    warnOnce(
      `provider:${raw}`,
      `[aiProvider] AI_PROVIDER ("${raw}") не из списка ${Object.keys(AI_PROVIDERS).join(', ')} — ` +
        `берётся "${DEFAULT_PROVIDER_ID}".`,
    );
    return AI_PROVIDERS[DEFAULT_PROVIDER_ID];
  }
  return AI_PROVIDERS[raw];
}

/**
 * Отличия в записи адреса (хвостовой слэш и т.п.) не меняют, куда уходит запрос,
 * а точное сравнение строк из-за них молча отключило бы перехват стоимости.
 */
export function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname =
      parsed.pathname !== '/' && parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return url;
  }
}

export function findProviderByBaseUrl(baseURL: string): AiProvider | undefined {
  const normalized = normalizeBaseUrl(baseURL);
  return Object.values(AI_PROVIDERS).find((provider) => {
    const configured = process.env[provider.baseUrlEnv]?.trim();
    return !!configured && normalizeBaseUrl(configured) === normalized;
  });
}

export function findProviderByEndpointName(endpointName: string): AiProvider | undefined {
  return Object.values(AI_PROVIDERS).find((provider) => provider.endpointName === endpointName);
}

/**
 * Заменяет {@link ACTIVE_ENDPOINT_PLACEHOLDER} на имя эндпоинта активного
 * провайдера. Эндпоинты остальных провайдеров остаются объявленными — их имена
 * записаны в старых беседах, и без объявления такая беседа не открылась бы.
 */
export function applyActiveAiEndpoint<T extends TSpecsConfig | null | undefined>(modelSpecs: T): T {
  const list = modelSpecs?.list;
  if (list == null) {
    return modelSpecs;
  }
  const { endpointName } = getActiveProvider();
  for (const spec of list) {
    if (spec.preset?.endpoint === ACTIVE_ENDPOINT_PLACEHOLDER) {
      spec.preset.endpoint = endpointName;
    }
  }
  return modelSpecs;
}
