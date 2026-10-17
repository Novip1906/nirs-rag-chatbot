import { Types } from 'mongoose';
import type { AppConfig, RecordUsageInput } from '@librechat/data-schemas';
import type { ServiceUsageDeps } from '../../serviceUsage';

export const departmentId: Types.ObjectId = new Types.ObjectId();

const NO_LIMITS = { dailyCostUsd: null };

export function usageDeps(): ServiceUsageDeps & { recordUsage: jest.Mock } {
  return {
    getGlobalSettings: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    getUserPolicy: async () => ({
      departmentId,
      limits: null,
      allowedModels: null,
      defaultModel: null,
      blocked: false,
    }),
    getDepartmentById: async () => ({
      systemPrompt: '',
      allowedModels: [],
      defaultModel: null,
      defaultLimits: NO_LIMITS,
    }),
    recordUsage: jest.fn(async (_input: RecordUsageInput): Promise<void> => undefined),
  };
}

export function endpoint(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    baseURL: 'https://gateway.test/api/v1/',
    apiKey: 'test-key',
    titleModel: 'openai/gpt-5.6-luna',
    models: { default: ['openai/gpt-5.6'] },
    ...overrides,
  };
}

export function appConfigWith(
  endpoints: Array<Record<string, unknown>> = [endpoint('OpenRouter')],
  config: Record<string, unknown> = {},
  memory: Record<string, unknown> = {},
): AppConfig {
  return { endpoints: { custom: endpoints }, config, memory } as unknown as AppConfig;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function completion(
  content: string | null,
  usage: Record<string, number> = {},
  finishReason = 'stop',
): Record<string, unknown> {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 120, completion_tokens: 30, ...usage },
  };
}

export interface CapturedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

export function capturingFetch(...responses: Array<Response | Error>): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let index = 0;
  const fetchImpl = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) {
      throw next;
    }
    return next.clone();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const ENV_KEYS = ['AI_PROVIDER', 'RUB_PER_USD', 'PROXY', 'HTTPS_PROXY', 'HTTP_PROXY'] as const;

export function isolateProviderEnv(): void {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });
}
