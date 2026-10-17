import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { AdminModelInputModality, AdminModelOption } from 'librechat-data-provider';
import type { Dispatcher } from 'undici';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { getActiveProvider } from '~/corporate/provider';
import { getEnvProxyDispatcher } from '~/utils/proxy';

const CATALOG_TIMEOUT_MS = 10_000;
/** 20 минут: каталог провайдера — сотни моделей, обновляется редко, а не на каждое
 *  открытие страницы админки. */
const CATALOG_CACHE_TTL_MS = 20 * 60 * 1000;

type FetchWithDispatcher = (
  input: string,
  init: RequestInit & { dispatcher?: Dispatcher },
) => Promise<globalThis.Response>;

export interface CorporateModelCatalogDeps {
  fetchImpl?: FetchWithDispatcher;
  now?: () => number;
}

interface RawProviderPricing {
  prompt_per_million?: string | number;
  completion_per_million?: string | number;
  image_input_per_million?: string | number;
  audio_per_million?: string | number;
  web_search_per_thousand?: string | number;
  input_cache_read_per_million?: string | number;
  input_cache_write_per_million?: string | number;
  currency?: string;
}

interface RawProviderModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  short_description?: string | null;
  /**
   * Вендор для UI/иконки — не `top_provider.name`, которое у многих записей называет
   * инфраструктуру хостинга, а не создателя модели (`azure`, `deepinfra/fp8`,
   * `atlas-cloud/fp8`). `icon_provider_slug` — фактический бренд (`qwen`, `anthropic`).
   */
  icon_provider_slug?: string | null;
  architecture?: {
    input_modalities?: unknown;
  } | null;
  top_provider?: {
    context_length?: number | null;
    pricing?: RawProviderPricing | null;
  } | null;
}

const KNOWN_MODALITIES: readonly AdminModelInputModality[] = [
  'text',
  'image',
  'file',
  'audio',
  'video',
];

function isKnownModality(value: unknown): value is AdminModelInputModality {
  return (KNOWN_MODALITIES as readonly unknown[]).includes(value);
}

function toModalities(value: unknown): AdminModelInputModality[] {
  return Array.isArray(value) ? value.filter(isKnownModality) : [];
}

/** Провайдер отдаёт запрошенное поле не всегда числом — иногда строкой с ценой. */
function toNumber(value: string | number | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function isRawProviderModel(value: unknown): value is RawProviderModel {
  return (
    value != null && typeof value === 'object' && typeof (value as RawProviderModel).id === 'string'
  );
}

export function normalizeProviderModel(raw: RawProviderModel): AdminModelOption {
  const id = raw.id as string;
  const pricing = raw.top_provider?.pricing;
  return {
    id,
    label: typeof raw.name === 'string' && raw.name !== '' ? raw.name : id,
    description: '',
    vendor: raw.icon_provider_slug ?? null,
    contextLength: raw.top_provider?.context_length ?? null,
    inputModalities: toModalities(raw.architecture?.input_modalities),
    shortDescription: raw.short_description ?? null,
    pricing: pricing
      ? {
          promptPerMillion: toNumber(pricing.prompt_per_million),
          completionPerMillion: toNumber(pricing.completion_per_million),
          imageInputPerMillion: toNumber(pricing.image_input_per_million),
          audioPerMillion: toNumber(pricing.audio_per_million),
          webSearchPerThousand: toNumber(pricing.web_search_per_thousand),
          inputCacheReadPerMillion: toNumber(pricing.input_cache_read_per_million),
          inputCacheWritePerMillion: toNumber(pricing.input_cache_write_per_million),
          currency: pricing.currency ?? null,
        }
      : null,
  };
}

/**
 * Только `type: 'chat'`: остальные типы каталога polza (image/video/stt/tts/embedding/
 * music) не отвечают на `/chat/completions` и не заработали бы в чате, даже если
 * администратор их разрешит.
 */
export function parseProviderCatalog(payload: unknown): AdminModelOption[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter(isRawProviderModel)
    .filter((model) => model.type === 'chat')
    .map(normalizeProviderModel);
}

/** Отдельный тип ошибки — маршрут отличает «провайдер недоступен» (502, понятный
 *  текст) от прочих сбоев (500). */
export class ProviderCatalogUnavailableError extends Error {}

interface CachedCatalog {
  models: AdminModelOption[];
  expiresAt: number;
}

export function createCorporateModelCatalogHandlers(deps: CorporateModelCatalogDeps = {}): {
  listProviderModels: (req: ServerRequest, res: Response) => Promise<Response>;
  getCatalog: () => Promise<AdminModelOption[]>;
} {
  const fetchImpl = deps.fetchImpl ?? (fetch as FetchWithDispatcher);
  const now = deps.now ?? Date.now;
  let cached: CachedCatalog | undefined;
  let inFlight: Promise<AdminModelOption[]> | undefined;

  async function loadCatalog(): Promise<AdminModelOption[]> {
    const provider = getActiveProvider();
    const baseUrl = process.env[provider.baseUrlEnv]?.trim() ?? '';
    const apiKey = process.env[provider.apiKeyEnv]?.trim() ?? '';
    if (baseUrl === '' || apiKey === '') {
      throw new ProviderCatalogUnavailableError(
        `Провайдер моделей не настроен: нет ${provider.baseUrlEnv} или ${provider.apiKeyEnv}.`,
      );
    }

    let response: globalThis.Response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        dispatcher: getEnvProxyDispatcher(),
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderCatalogUnavailableError(
        `Не удалось обратиться к провайдеру за каталогом моделей: ${message}`,
      );
    }

    if (!response.ok) {
      throw new ProviderCatalogUnavailableError(
        `Провайдер ответил ${response.status} на запрос каталога моделей.`,
      );
    }

    return parseProviderCatalog(await response.json());
  }

  async function getCatalogInternal(): Promise<AdminModelOption[]> {
    const requestedAt = now();
    if (cached != null && cached.expiresAt > requestedAt) {
      return cached.models;
    }
    if (inFlight == null) {
      inFlight = loadCatalog()
        .then((models) => {
          cached = { models, expiresAt: now() + CATALOG_CACHE_TTL_MS };
          return models;
        })
        .catch((error) => {
          if (cached != null) {
            logger.warn(
              '[corporateModelCatalog] Провайдер недоступен, отдаю ранее закэшированный каталог:',
              error,
            );
            return cached.models;
          }
          throw error;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  }

  async function listProviderModelsHandler(req: ServerRequest, res: Response) {
    if (!isAdminLevelRole(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const models = await getCatalogInternal();
      return res.status(200).json({ models });
    } catch (error) {
      logger.error('[corporateModelCatalog] listProviderModels error:', error);
      const message =
        error instanceof ProviderCatalogUnavailableError
          ? error.message
          : 'Не удалось получить каталог моделей от провайдера.';
      return res.status(502).json({ error: message });
    }
  }

  return { listProviderModels: listProviderModelsHandler, getCatalog: getCatalogInternal };
}

/**
 * Один общий кэш на процесс: admin-каталог (`office.js`) и подстановка синтетических
 * спеков для чата (`filterModelSpecsForUser` в `config.js`) должны видеть один и тот же
 * фетч, а не дублировать запрос к провайдеру и держать две независимо протухающие копии.
 */
export const corporateModelCatalog: ReturnType<typeof createCorporateModelCatalogHandlers> =
  createCorporateModelCatalogHandlers();
