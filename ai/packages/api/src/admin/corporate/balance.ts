import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { AdminProviderBalance } from 'librechat-data-provider';
import type { Dispatcher } from 'undici';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { convertToUsd, getActiveProvider } from '~/corporate/provider';
import { getEnvProxyDispatcher } from '~/utils/proxy';

const BALANCE_TIMEOUT_MS = 8_000;
const BALANCE_CACHE_TTL_MS = 60_000;
const BALANCE_ERROR_CACHE_TTL_MS = 15_000;

type FetchWithDispatcher = (
  input: string,
  init: RequestInit & { dispatcher?: Dispatcher },
) => Promise<globalThis.Response>;

export interface CorporateBalanceDeps {
  fetchImpl?: FetchWithDispatcher;
  now?: () => number;
}

interface CachedBalance {
  balance: AdminProviderBalance;
  expiresAt: number;
}

function readProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function createCorporateBalanceHandlers(deps: CorporateBalanceDeps = {}): {
  getProviderBalance: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const fetchImpl = deps.fetchImpl ?? (fetch as FetchWithDispatcher);
  const now = deps.now ?? Date.now;
  let cached: CachedBalance | undefined;
  let inFlight: Promise<AdminProviderBalance> | undefined;

  async function loadBalance(): Promise<AdminProviderBalance> {
    const activeProvider = getActiveProvider();
    const baseUrl = process.env[activeProvider.baseUrlEnv]?.trim() ?? '';
    const apiKey = process.env[activeProvider.apiKeyEnv]?.trim() ?? '';
    const provider = baseUrl === '' ? '' : readProviderName(baseUrl);
    const checkedAt = new Date(now()).toISOString();

    if (baseUrl === '' || apiKey === '') {
      return { provider, status: 'not_configured', amountUsd: null, checkedAt };
    }

    try {
      const response = await fetchImpl(
        `${baseUrl.replace(/\/+$/, '')}${activeProvider.balancePath}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          dispatcher: getEnvProxyDispatcher(),
          signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        logger.warn(
          `[corporateBalance] ${provider} answered ${response.status} to a balance request`,
        );
        return { provider, status: 'unavailable', amountUsd: null, checkedAt };
      }
      const amount = activeProvider.parseBalance(await response.json());
      if (amount == null) {
        logger.warn(`[corporateBalance] ${provider} returned a balance without a numeric amount`);
        return { provider, status: 'unavailable', amountUsd: null, checkedAt };
      }
      return {
        provider,
        status: 'ok',
        amountUsd: convertToUsd(amount, activeProvider.currency),
        checkedAt,
      };
    } catch (error) {
      logger.error('[corporateBalance] balance request failed:', error);
      return { provider, status: 'unavailable', amountUsd: null, checkedAt };
    }
  }

  async function getProviderBalanceHandler(req: ServerRequest, res: Response) {
    /** Баланс провайдера — общекорпоративный финансовый показатель, отдела у него нет. */
    if (!isAdminLevelRole(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const requestedAt = now();
    if (cached != null && cached.expiresAt > requestedAt) {
      return res.status(200).json({ balance: cached.balance });
    }

    if (inFlight == null) {
      inFlight = loadBalance().finally(() => {
        inFlight = undefined;
      });
    }
    const balance = await inFlight;
    cached = {
      balance,
      expiresAt:
        requestedAt + (balance.status === 'ok' ? BALANCE_CACHE_TTL_MS : BALANCE_ERROR_CACHE_TTL_MS),
    };
    return res.status(200).json({ balance });
  }

  return { getProviderBalance: getProviderBalanceHandler };
}
