import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createCorporateBalanceHandlers } from './balance';

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

function credits(total: number, used: number) {
  return { data: { total_credits: total, total_usage: used } };
}

describe('createCorporateBalanceHandlers', () => {
  const originalBaseUrl = process.env.OPENROUTER_BASE_URL;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.OPENROUTER_BASE_URL = originalBaseUrl;
    process.env.OPENROUTER_API_KEY = originalApiKey;
  });

  it('reports the credits left, not the credits bought', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(credits(20, 4.75)));
    const handlers = createCorporateBalanceHandlers({ fetchImpl, now: () => 1_700_000_000_000 });
    const { req, res, status, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      balance: {
        provider: 'openrouter.ai',
        status: 'ok',
        amountUsd: 15.25,
        checkedAt: new Date(1_700_000_000_000).toISOString(),
      },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/credits');
    expect(init.headers).toEqual({ Authorization: 'Bearer test-key' });
  });

  it('reports a zero balance for an account that never bought credits', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(credits(0, 0)));
    const handlers = createCorporateBalanceHandlers({ fetchImpl });
    const { req, res, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(json.mock.calls[0][0].balance).toMatchObject({ status: 'ok', amountUsd: 0 });
  });

  it('reports not_configured when the key is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchImpl = jest.fn();
    const handlers = createCorporateBalanceHandlers({ fetchImpl });
    const { req, res, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(json.mock.calls[0][0].balance.status).toBe('not_configured');
  });

  it('reports unavailable when the provider rejects the request', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 401));
    const handlers = createCorporateBalanceHandlers({ fetchImpl });
    const { req, res, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(json.mock.calls[0][0].balance).toMatchObject({
      status: 'unavailable',
      amountUsd: null,
    });
  });

  it('reports unavailable when totals are missing from the payload', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: { total_credits: 5 } }));
    const handlers = createCorporateBalanceHandlers({ fetchImpl });
    const { req, res, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(json.mock.calls[0][0].balance.status).toBe('unavailable');
  });

  it('reports unavailable when the request throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const handlers = createCorporateBalanceHandlers({ fetchImpl });
    const { req, res, json } = createReqRes();

    await handlers.getProviderBalance(req, res);

    expect(json.mock.calls[0][0].balance.status).toBe('unavailable');
  });

  it('serves a cached balance until the ttl expires', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(credits(100, 0)));
    let clock = 1_000;
    const handlers = createCorporateBalanceHandlers({ fetchImpl, now: () => clock });

    const first = createReqRes();
    await handlers.getProviderBalance(first.req, first.res);
    clock += 30_000;
    const second = createReqRes();
    await handlers.getProviderBalance(second.req, second.res);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 31_000;
    const third = createReqRes();
    await handlers.getProviderBalance(third.req, third.res);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a failed balance sooner than a successful one', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 500));
    let clock = 1_000;
    const handlers = createCorporateBalanceHandlers({ fetchImpl, now: () => clock });

    const first = createReqRes();
    await handlers.getProviderBalance(first.req, first.res);
    clock += 16_000;
    const second = createReqRes();
    await handlers.getProviderBalance(second.req, second.res);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  describe('department scope', () => {
    /** Баланс провайдера — общекорпоративный показатель, отдела у него нет. */
    it('rejects a department head outright', async () => {
      const fetchImpl = jest.fn();
      const handlers = createCorporateBalanceHandlers({ fetchImpl });
      const { req, res, status } = createReqRes({ role: 'HEAD' });

      await handlers.getProviderBalance(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects an employee outright', async () => {
      const fetchImpl = jest.fn();
      const handlers = createCorporateBalanceHandlers({ fetchImpl });
      const { req, res, status } = createReqRes({ role: 'USER' });

      await handlers.getProviderBalance(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('когда активен polza', () => {
    const originalProvider = process.env.AI_PROVIDER;
    const originalPolzaBaseUrl = process.env.AI_BASE_URL;
    const originalPolzaApiKey = process.env.AI_API_KEY;
    const originalRate = process.env.RUB_PER_USD;

    beforeEach(() => {
      process.env.AI_PROVIDER = 'polza';
      process.env.AI_BASE_URL = 'https://polza.ai/api/v1';
      process.env.AI_API_KEY = 'pza-test-key';
      process.env.RUB_PER_USD = '80';
    });

    afterEach(() => {
      const restore = {
        AI_PROVIDER: originalProvider,
        AI_BASE_URL: originalPolzaBaseUrl,
        AI_API_KEY: originalPolzaApiKey,
        RUB_PER_USD: originalRate,
      };
      for (const [key, value] of Object.entries(restore)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it('спрашивает баланс у polza и пересчитывает рубли в доллары', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse({ amount: '160.00', reservedAmount: '0.00' }));
      const handlers = createCorporateBalanceHandlers({ fetchImpl, now: () => 1_700_000_000_000 });
      const { req, res, json } = createReqRes();

      await handlers.getProviderBalance(req, res);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://polza.ai/api/v1/balance');
      expect(init.headers).toEqual({ Authorization: 'Bearer pza-test-key' });
      expect(json.mock.calls[0][0].balance).toMatchObject({
        provider: 'polza.ai',
        status: 'ok',
        amountUsd: 2,
      });
    });

    it('сообщает not_configured, когда нет ключа polza', async () => {
      delete process.env.AI_API_KEY;
      const fetchImpl = jest.fn();
      const handlers = createCorporateBalanceHandlers({ fetchImpl });
      const { req, res, json } = createReqRes();

      await handlers.getProviderBalance(req, res);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(json.mock.calls[0][0].balance.status).toBe('not_configured');
    });

    it('сообщает unavailable, когда в ответе нет числового остатка', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ reservedAmount: '0.00' }));
      const handlers = createCorporateBalanceHandlers({ fetchImpl });
      const { req, res, json } = createReqRes();

      await handlers.getProviderBalance(req, res);

      expect(json.mock.calls[0][0].balance).toMatchObject({
        status: 'unavailable',
        amountUsd: null,
      });
    });
  });
});
