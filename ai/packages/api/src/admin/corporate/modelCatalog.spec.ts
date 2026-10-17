import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  createCorporateModelCatalogHandlers,
  normalizeProviderModel,
  parseProviderCatalog,
} from './modelCatalog';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function createReqRes(caller: { role?: string } = {}) {
  const req = {
    params: {},
    query: {},
    body: {},
    user: { _id: 'admin-1', role: caller.role ?? 'ADMIN' },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function jsonResponse(payload: unknown, ok = true, statusCode = 200): Response {
  return {
    ok,
    status: statusCode,
    json: async () => payload,
  } as unknown as Response;
}

function chatModel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'qwen/qwen3.8-flash',
    name: 'Qwen: Qwen3.8 Flash',
    type: 'chat',
    icon_provider_slug: 'qwen',
    short_description: null,
    architecture: { input_modalities: ['text', 'image', 'video'] },
    top_provider: {
      name: 'alibaba',
      context_length: 1_000_000,
      pricing: {
        prompt_per_million: '17.83305000',
        completion_per_million: '55.87689000',
        currency: 'RUB',
      },
    },
    ...overrides,
  };
}

describe('parseProviderCatalog', () => {
  it('keeps only chat models and normalizes pricing/context/vendor/modalities', () => {
    const catalog = parseProviderCatalog({
      data: [
        chatModel(),
        { id: 'alibaba/wan-3.0-prime', name: 'Wan 3.0', type: 'video' },
        { id: 'openai/whisper', name: 'Whisper', type: 'stt' },
      ],
    });

    expect(catalog).toEqual([
      {
        id: 'qwen/qwen3.8-flash',
        label: 'Qwen: Qwen3.8 Flash',
        description: '',
        vendor: 'qwen',
        contextLength: 1_000_000,
        inputModalities: ['text', 'image', 'video'],
        shortDescription: null,
        pricing: {
          promptPerMillion: 17.83305,
          completionPerMillion: 55.87689,
          imageInputPerMillion: null,
          audioPerMillion: null,
          webSearchPerThousand: null,
          inputCacheReadPerMillion: null,
          inputCacheWritePerMillion: null,
          currency: 'RUB',
        },
      },
    ]);
  });

  /**
   * `vendor` берётся из `icon_provider_slug`, а не из `top_provider.name`: для многих
   * записей `top_provider.name` называет инфраструктуру хостинга (`azure`,
   * `deepinfra/fp8`), а не создателя модели.
   */
  it('reads vendor from icon_provider_slug, not top_provider.name', () => {
    const catalog = parseProviderCatalog({
      data: [chatModel({ icon_provider_slug: 'anthropic', top_provider: { name: 'azure' } })],
    });

    expect(catalog[0].vendor).toBe('anthropic');
  });

  it('keeps only recognized modalities and defaults to an empty array', () => {
    const catalog = parseProviderCatalog({
      data: [
        chatModel({ architecture: { input_modalities: ['text', 'smell', 'audio'] } }),
        chatModel({ id: 'no-architecture', architecture: undefined }),
      ],
    });

    expect(catalog[0].inputModalities).toEqual(['text', 'audio']);
    expect(catalog[1].inputModalities).toEqual([]);
  });

  it('includes the extra pricing fields the provider sends for some models', () => {
    const catalog = parseProviderCatalog({
      data: [
        chatModel({
          top_provider: {
            pricing: {
              prompt_per_million: '10',
              completion_per_million: '20',
              image_input_per_million: '30',
              audio_per_million: '40',
              web_search_per_thousand: '5',
              input_cache_read_per_million: '1',
              input_cache_write_per_million: '2',
              currency: 'RUB',
            },
          },
        }),
      ],
    });

    expect(catalog[0].pricing).toEqual({
      promptPerMillion: 10,
      completionPerMillion: 20,
      imageInputPerMillion: 30,
      audioPerMillion: 40,
      webSearchPerThousand: 5,
      inputCacheReadPerMillion: 1,
      inputCacheWritePerMillion: 2,
      currency: 'RUB',
    });
  });

  it('falls back to id as label and null pricing/vendor when missing', () => {
    const catalog = parseProviderCatalog({
      data: [{ id: 'some/model', type: 'chat' }],
    });

    expect(catalog).toEqual([
      {
        id: 'some/model',
        label: 'some/model',
        description: '',
        vendor: null,
        contextLength: null,
        inputModalities: [],
        shortDescription: null,
        pricing: null,
      },
    ]);
  });

  it('returns an empty list for malformed payloads', () => {
    expect(parseProviderCatalog(null)).toEqual([]);
    expect(parseProviderCatalog({})).toEqual([]);
    expect(parseProviderCatalog({ data: 'not-an-array' })).toEqual([]);
    expect(parseProviderCatalog({ data: [{ type: 'chat' }] })).toEqual([]);
  });
});

describe('normalizeProviderModel', () => {
  it('treats a non-numeric price string as unknown rather than NaN', () => {
    const model = normalizeProviderModel({
      id: 'x/y',
      type: 'chat',
      top_provider: { pricing: { prompt_per_million: 'n/a', currency: 'RUB' } },
    });

    expect(model.pricing).toEqual({
      promptPerMillion: null,
      completionPerMillion: null,
      imageInputPerMillion: null,
      audioPerMillion: null,
      webSearchPerThousand: null,
      inputCacheReadPerMillion: null,
      inputCacheWritePerMillion: null,
      currency: 'RUB',
    });
  });
});

describe('createCorporateModelCatalogHandlers', () => {
  const originalBaseUrl = process.env.AI_BASE_URL;
  const originalApiKey = process.env.AI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;

  beforeEach(() => {
    process.env.AI_PROVIDER = 'polza';
    process.env.AI_BASE_URL = 'https://polza.ai/api/v1';
    process.env.AI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.AI_BASE_URL = originalBaseUrl;
    process.env.AI_API_KEY = originalApiKey;
    process.env.AI_PROVIDER = originalProvider;
  });

  it('rejects a non-admin caller without hitting the provider', async () => {
    const fetchImpl = jest.fn();
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl });
    const { req, res, status } = createReqRes({ role: 'USER' });

    await handlers.listProviderModels(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lists the catalog for an admin and requests /models with the provider key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [chatModel()] }));
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl });
    const { req, res, status, json } = createReqRes();

    await handlers.listProviderModels(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0][0].models).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://polza.ai/api/v1/models');
    expect(init.headers).toEqual({ Authorization: 'Bearer test-key' });
  });

  it('caches the catalog and does not re-fetch within the TTL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [chatModel()] }));
    let time = 1_000;
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl, now: () => time });
    const { req, res } = createReqRes();

    await handlers.listProviderModels(req, res);
    time += 60_000;
    await handlers.listProviderModels(req, res);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cache expires', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [chatModel()] }));
    let time = 1_000;
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl, now: () => time });
    const { req, res } = createReqRes();

    await handlers.listProviderModels(req, res);
    time += 21 * 60 * 1000;
    await handlers.listProviderModels(req, res);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves the stale cache instead of failing when the provider goes down after a successful fetch', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [chatModel()] }))
      .mockRejectedValueOnce(new Error('network down'));
    let time = 1_000;
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl, now: () => time });
    const { req, res, status, json } = createReqRes();

    await handlers.listProviderModels(req, res);
    time += 21 * 60 * 1000;
    await handlers.listProviderModels(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[1][0].models).toHaveLength(1);
  });

  it('returns a clear 502 body, not an empty 500, when the provider has never answered', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl });
    const { req, res, status, json } = createReqRes();

    await handlers.listProviderModels(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(json.mock.calls[0][0].error).toEqual(expect.any(String));
    expect(json.mock.calls[0][0].error.length).toBeGreaterThan(0);
  });

  it('returns a clear 502 when the provider key is not configured', async () => {
    process.env.AI_API_KEY = '';
    const fetchImpl = jest.fn();
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl });
    const { req, res, status, json } = createReqRes();

    await handlers.listProviderModels(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(json.mock.calls[0][0].error).toEqual(expect.any(String));
  });

  it('coalesces concurrent misses into a single upstream request', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchImpl = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const handlers = createCorporateModelCatalogHandlers({ fetchImpl });
    const { req, res: res1 } = createReqRes();
    const { res: res2 } = createReqRes();

    const call1 = handlers.listProviderModels(req, res1);
    const call2 = handlers.listProviderModels(req, res2);
    resolveFetch(jsonResponse({ data: [chatModel()] }));
    await Promise.all([call1, call2]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
