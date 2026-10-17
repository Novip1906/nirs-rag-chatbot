import { logger } from '@librechat/data-schemas';
import { normalizeOpenIdIssuer } from '../auth/openid';

export interface DirectoryEmployee {
  id: string;
  sub: string;
  email: string;
  first_name: string;
  last_name: string;
  position: string;
  department_id: string | null;
  is_admin: boolean;
  blocked: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface DirectoryDepartment {
  id: string;
  name: string;
  description: string;
  updated_at: string;
  deleted_at: string | null;
}

export type DirectoryFetch<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_configured' | 'unavailable' | 'not_found' };

export interface DirectoryClient {
  isConfigured(): boolean;
  listEmployees(): Promise<DirectoryFetch<DirectoryEmployee[]>>;
  listDepartments(): Promise<DirectoryFetch<DirectoryDepartment[]>>;
  getEmployee(id: string): Promise<DirectoryFetch<DirectoryEmployee>>;
  getEmployeeBySub(sub: string): Promise<DirectoryFetch<DirectoryEmployee>>;
}

const REQUEST_TIMEOUT_MS = 10000;
const TOKEN_EXPIRY_MARGIN_MS = 30000;
const DEFAULT_CLIENT_ID = 'ai-admin-api';

interface DirectoryConfig {
  apiUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

function readConfig(env: NodeJS.ProcessEnv): DirectoryConfig | undefined {
  const apiUrl = env.ADMIN_API_URL;
  const clientSecret = env.ADMIN_API_CLIENT_SECRET;
  const issuer = normalizeOpenIdIssuer(env.OPENID_ISSUER);
  if (!apiUrl || !clientSecret || !issuer) {
    return undefined;
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    tokenUrl: `${issuer}/protocol/openid-connect/token`,
    clientId: env.ADMIN_API_CLIENT_ID || DEFAULT_CLIENT_ID,
    clientSecret,
  };
}

export function createDirectoryClient(
  options: { fetchFn?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): DirectoryClient {
  const fetchFn = options.fetchFn ?? fetch;
  const env = options.env ?? process.env;
  const config = readConfig(env);

  let cachedToken: { value: string; expiresAt: number } | undefined;

  async function fetchToken(cfg: DirectoryConfig): Promise<string | undefined> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.value;
    }
    cachedToken = undefined;
    try {
      const response = await fetchFn(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn('[directoryClient] Token endpoint rejected the service credentials', {
          status: response.status,
        });
        return undefined;
      }
      const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== 'string' || body.access_token === '') {
        return undefined;
      }
      const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 0;
      cachedToken = {
        value: body.access_token,
        expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS,
      };
      return body.access_token;
    } catch (err) {
      const error = err as { name?: string; message?: string };
      logger.warn('[directoryClient] Failed to obtain a service token', {
        name: error?.name,
        message: error?.message,
      });
      return undefined;
    }
  }

  async function get<T>(
    cfg: DirectoryConfig,
    path: string,
    pick: (body: unknown) => T | undefined,
  ): Promise<DirectoryFetch<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await fetchToken(cfg);
      if (!token) {
        return { ok: false, reason: 'unavailable' };
      }
      let response: Response;
      try {
        response = await fetchFn(`${cfg.apiUrl}${path}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const error = err as { name?: string; message?: string };
        logger.warn('[directoryClient] Request failed', {
          path,
          name: error?.name,
          message: error?.message,
        });
        return { ok: false, reason: 'unavailable' };
      }
      if (response.status === 401 && attempt === 0) {
        cachedToken = undefined;
        continue;
      }
      if (response.status === 404) {
        return { ok: false, reason: 'not_found' };
      }
      if (!response.ok) {
        logger.warn('[directoryClient] Unexpected status', { path, status: response.status });
        return { ok: false, reason: 'unavailable' };
      }
      try {
        const value = pick(await response.json());
        if (value === undefined) {
          logger.warn('[directoryClient] Unexpected response shape', { path });
          return { ok: false, reason: 'unavailable' };
        }
        return { ok: true, value };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    }
    return { ok: false, reason: 'unavailable' };
  }

  const pickItems =
    <T>() =>
    (body: unknown): T[] | undefined => {
      const items = (body as { items?: unknown } | null)?.items;
      return Array.isArray(items) ? (items as T[]) : undefined;
    };

  const pickRecord =
    <T>() =>
    (body: unknown): T | undefined =>
      body !== null && typeof body === 'object' ? (body as T) : undefined;

  const notConfigured = { ok: false, reason: 'not_configured' } as const;

  return {
    isConfigured: () => config !== undefined,
    listEmployees: async () =>
      config
        ? get(config, '/v1/employees?include_deleted=true', pickItems<DirectoryEmployee>())
        : notConfigured,
    listDepartments: async () =>
      config
        ? get(config, '/v1/departments?include_deleted=true', pickItems<DirectoryDepartment>())
        : notConfigured,
    getEmployee: async (id) =>
      config
        ? get(config, `/v1/employees/${encodeURIComponent(id)}`, pickRecord<DirectoryEmployee>())
        : notConfigured,
    getEmployeeBySub: async (sub) =>
      config
        ? get(
            config,
            `/v1/employees/by-sub/${encodeURIComponent(sub)}`,
            pickRecord<DirectoryEmployee>(),
          )
        : notConfigured,
  };
}
