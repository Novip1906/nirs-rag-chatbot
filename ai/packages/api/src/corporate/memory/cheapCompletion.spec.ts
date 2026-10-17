import { Constants, DEFAULT_DLP_CONFIG } from 'librechat-data-provider';
import type { CheapCompletionInput } from './cheapCompletion';
import {
  endpoint,
  completion,
  jsonResponse,
  appConfigWith,
  capturingFetch,
  isolateProviderEnv,
} from './__tests__/helpers/fixtures';
import { completeCheap } from './cheapCompletion';

function baseInput(overrides: Partial<CheapCompletionInput> = {}): CheapCompletionInput {
  return {
    appConfig: appConfigWith(),
    userId: 'user-1',
    userName: 'Иван',
    conversationId: 'convo-1',
    system: 'Системная инструкция',
    prompt: 'Текст беседы',
    maxTokens: 1200,
    timeoutMs: 5_000,
    ...overrides,
  };
}

isolateProviderEnv();

describe('completeCheap', () => {
  it('отправляет titleModel активного эндпоинта с низким рассуждением и учётом стоимости', async () => {
    const { fetchImpl, calls } = capturingFetch(
      jsonResponse(completion('Конспект', { cost: 0.0004 })),
    );

    const result = await completeCheap(baseInput({ fetchImpl }));

    expect(result).toEqual({
      text: 'Конспект',
      model: 'openai/gpt-5.6-luna',
      promptTokens: 120,
      completionTokens: 30,
      costUsd: 0.0004,
      truncated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gateway.test/api/v1/chat/completions');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].body).toEqual({
      model: 'openai/gpt-5.6-luna',
      messages: [
        { role: 'system', content: 'Системная инструкция' },
        { role: 'user', content: 'Текст беседы' },
      ],
      max_tokens: 1200,
      reasoning: { effort: 'low', exclude: true },
      usage: { include: true },
    });
  });

  it('для JSON просит json_object и требует от OpenRouter поддержки параметров', async () => {
    const { fetchImpl, calls } = capturingFetch(jsonResponse(completion('{"entries":[]}')));

    await completeCheap(baseInput({ fetchImpl, json: true }));

    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    expect(calls[0].body.provider).toEqual({ require_parameters: true });
  });

  it('у polza берёт её эндпоинт, не шлёт полей OpenRouter и считает рубли в доллары', async () => {
    process.env.AI_PROVIDER = 'polza';
    process.env.RUB_PER_USD = '80';
    const { fetchImpl, calls } = capturingFetch(
      jsonResponse(completion('Конспект', { cost_rub: 8 })),
    );
    const appConfig = appConfigWith([
      endpoint('OpenRouter', { titleModel: 'openrouter-model' }),
      endpoint('Corporate AI', { baseURL: 'https://polza.test/api/v1', titleModel: 'polza-model' }),
    ]);

    const result = await completeCheap(baseInput({ fetchImpl, appConfig, json: true }));

    expect(calls[0].url).toBe('https://polza.test/api/v1/chat/completions');
    expect(calls[0].body.model).toBe('polza-model');
    expect(calls[0].body).not.toHaveProperty('reasoning');
    expect(calls[0].body).not.toHaveProperty('usage');
    expect(calls[0].body).not.toHaveProperty('provider');
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' });
    expect(result?.costUsd).toBeCloseTo(0.1);
  });

  it('возвращает null без запроса без titleModel, при current_model и без своего ключа', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('Конспект')));

    const missing = await completeCheap(
      baseInput({
        fetchImpl,
        appConfig: appConfigWith([endpoint('OpenRouter', { titleModel: undefined })]),
      }),
    );
    const current = await completeCheap(
      baseInput({
        fetchImpl,
        appConfig: appConfigWith([endpoint('OpenRouter', { titleModel: Constants.CURRENT_MODEL })]),
      }),
    );
    const noEndpoint = await completeCheap(baseInput({ fetchImpl, appConfig: appConfigWith([]) }));
    const userKey = await completeCheap(
      baseInput({
        fetchImpl,
        appConfig: appConfigWith([endpoint('OpenRouter', { apiKey: 'user_provided' })]),
      }),
    );

    expect(missing).toBeNull();
    expect(current).toBeNull();
    expect(noEndpoint).toBeNull();
    expect(userKey).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('бросает при ошибке HTTP, не раскрывая тело ответа', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse({ error: 'секрет провайдера' }, 502));

    await expect(completeCheap(baseInput({ fetchImpl }))).rejects.toThrow(/502/);
    await expect(completeCheap(baseInput({ fetchImpl }))).rejects.not.toThrow(/секрет/);
  });

  it('при обрезке по лимиту токенов и пустом ответе возвращает пустой текст с расходом', async () => {
    const empty = capturingFetch(jsonResponse(completion('   ', { cost: 0.001 })));
    const cut = capturingFetch(jsonResponse(completion('Незаконч', { cost: 0.002 }, 'length')));
    const none = capturingFetch(jsonResponse({ choices: [] }));

    await expect(completeCheap(baseInput({ fetchImpl: empty.fetchImpl }))).resolves.toEqual({
      text: '',
      model: 'openai/gpt-5.6-luna',
      promptTokens: 120,
      completionTokens: 30,
      costUsd: 0.001,
      truncated: false,
    });
    await expect(completeCheap(baseInput({ fetchImpl: cut.fetchImpl }))).resolves.toEqual({
      text: '',
      model: 'openai/gpt-5.6-luna',
      promptTokens: 120,
      completionTokens: 30,
      costUsd: 0.002,
      truncated: true,
    });
    await expect(completeCheap(baseInput({ fetchImpl: none.fetchImpl }))).resolves.toMatchObject({
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      truncated: false,
    });
  });

  it('записывает стоимость как null, если провайдер её не прислал', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('Конспект')));

    const result = await completeCheap(baseInput({ fetchImpl }));

    expect(result?.costUsd).toBeNull();
  });

  it('прерывается по внешнему сигналу', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;

    const pending = completeCheap(baseInput({ fetchImpl, signal: controller.signal }));
    controller.abort(new Error('stopped'));

    await expect(pending).rejects.toThrow('stopped');
  });

  it('при включённом DLP маскирует данные перед отправкой и пишет аудит', async () => {
    const { fetchImpl, calls } = capturingFetch(jsonResponse(completion('Карта [CARD_1] принята')));
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const appConfig = appConfigWith([endpoint('OpenRouter')], {
      dlp: { ...DEFAULT_DLP_CONFIG, enabled: true },
    });

    const result = await completeCheap(
      baseInput({
        fetchImpl,
        appConfig,
        recordAuditEntry,
        prompt: 'Оплата картой 4111111111111111',
      }),
    );

    const sent = JSON.stringify(calls[0].body);
    expect(sent).not.toContain('4111111111111111');
    expect(sent).toContain('CARD_1');
    expect(recordAuditEntry).toHaveBeenCalled();
    expect(result?.text).toContain('4111111111111111');
  });

  it('без журнала аудита DLP не подключает и шлёт текст как есть', async () => {
    const { fetchImpl, calls } = capturingFetch(jsonResponse(completion('Готово')));
    const appConfig = appConfigWith([endpoint('OpenRouter')], {
      dlp: { ...DEFAULT_DLP_CONFIG, enabled: true },
    });

    await completeCheap(baseInput({ fetchImpl, appConfig, prompt: 'карта 4111111111111111' }));

    expect(JSON.stringify(calls[0].body)).toContain('4111111111111111');
  });
});
