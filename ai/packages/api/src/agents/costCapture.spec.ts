import { AI_PROVIDERS, DEFAULT_RUB_PER_USD } from '~/corporate/provider';
import { recordCapturedCost, takeCapturedCost, wrapFetchWithCostCapture } from './costCapture';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('recordCapturedCost / takeCapturedCost', () => {
  it('возвращает записанную стоимость один раз и удаляет запись после чтения', () => {
    recordCapturedCost('gen-1', 0.0042);
    expect(takeCapturedCost('gen-1')).toBe(0.0042);
    expect(takeCapturedCost('gen-1')).toBeUndefined();
  });

  it('возвращает undefined для неизвестного или пустого id', () => {
    expect(takeCapturedCost('unknown-id')).toBeUndefined();
    expect(takeCapturedCost(undefined)).toBeUndefined();
    expect(takeCapturedCost(null)).toBeUndefined();
  });

  it('запись истекает по TTL и больше не отдаётся', () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      jest.setSystemTime(0);
      recordCapturedCost('gen-ttl', 0.01);
      jest.setSystemTime(5 * 60 * 1000 + 1);
      expect(takeCapturedCost('gen-ttl')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('wrapFetchWithCostCapture', () => {
  it('захватывает usage.cost из нестримингового JSON-ответа, не потребляя тело для вызывающего', async () => {
    const upstream = jest
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'gen-json-1', usage: { cost: 0.00072196 } }));
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const response = await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    const data = (await response.json()) as { id: string };
    expect(data.id).toBe('gen-json-1');

    await flushMicrotasks();
    expect(takeCapturedCost('gen-json-1')).toBeCloseTo(0.00072196);
  });

  it('добавляет stream_options.include_usage в тело запроса при stream: true', async () => {
    let capturedInit: RequestInit | undefined;
    const upstream = jest.fn().mockImplementation((_input: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(sseResponse(['data: [DONE]\n\n']));
    });
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });

    const sentBody = JSON.parse(capturedInit?.body as string) as {
      stream_options?: { include_usage?: boolean };
    };
    expect(sentBody.stream_options?.include_usage).toBe(true);
  });

  it('не трогает тело запроса, когда stream не true', async () => {
    let capturedInit: RequestInit | undefined;
    const upstream = jest.fn().mockImplementation((_input: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse({ id: 'gen-x', usage: {} }));
    });
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const originalBody = JSON.stringify({ model: 'x' });
    await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: originalBody,
    });

    expect(capturedInit?.body).toBe(originalBody);
  });

  it('парсит SSE построчно и запоминает id/усечённую стоимость последнего чанка с usage, не буферизуя весь поток', async () => {
    const chunks = [
      'data: {"id":"gen-sse-1","choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"id":"gen-sse-1","choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"id":"gen-sse-1","choices":[{"delta":{}}],"usage":{"cost":0.0004716}}\n\n',
      'data: [DONE]\n\n',
    ];
    const upstream = jest.fn().mockResolvedValue(sseResponse(chunks));
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const response = await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let forwarded = '';
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        forwarded += decoder.decode(value);
      }
    }
    expect(forwarded).toContain('"content":"Hel"');
    expect(forwarded).toContain('[DONE]');

    await flushMicrotasks();
    expect(takeCapturedCost('gen-sse-1')).toBeCloseTo(0.0004716);
  });

  it('не удваивает стоимость, если провайдер присылает usage на двух чанках подряд', async () => {
    const chunks = [
      'data: {"id":"gen-sse-2","usage":{"cost":0.0004716}}\n\n',
      'data: {"id":"gen-sse-2","usage":{"cost":0.0004716}}\n\n',
      'data: [DONE]\n\n',
    ];
    const upstream = jest.fn().mockResolvedValue(sseResponse(chunks));
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const response = await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });
    await response.body?.cancel();

    await flushMicrotasks();
    expect(takeCapturedCost('gen-sse-2')).toBeCloseTo(0.0004716);
  });

  /**
   * The stream below enqueues its usage chunk and `[DONE]` but is
   * deliberately never closed — mirrors a provider that keeps the connection
   * open (keep-alive/HTTP2) well past `[DONE]`. The background reader stays
   * parked in `reader.read()` for the rest of the test; the cost must still
   * be available immediately after the usage chunk is parsed, not only once
   * that read eventually resolves.
   */
  it('записывает стоимость сразу при разборе usage-чанка, не дожидаясь закрытия потока', async () => {
    const encoder = new TextEncoder();
    let enqueueUsageChunk: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"gen-sse-slow-close","choices":[]}\n\n'));
        enqueueUsageChunk = () => {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"gen-sse-slow-close","usage":{"cost":0.0009},"choices":[]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        };
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const upstream = jest.fn().mockResolvedValue(response);
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });
    await flushMicrotasks();
    expect(takeCapturedCost('gen-sse-slow-close')).toBeUndefined();

    enqueueUsageChunk?.();
    await flushMicrotasks();

    expect(takeCapturedCost('gen-sse-slow-close')).toBeCloseTo(0.0009);
  });

  it('не добавляет stream_options к телу запроса на URL, не оканчивающемся на /chat/completions', async () => {
    let capturedInit: RequestInit | undefined;
    const upstream = jest.fn().mockImplementation((_input: string, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(jsonResponse({ id: 'resp-1', usage: {} }));
    });
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const originalBody = JSON.stringify({ model: 'x', stream: true });
    await wrapped('https://polza.ai/api/v1/responses', {
      method: 'POST',
      body: originalBody,
    });

    expect(capturedInit?.body).toBe(originalBody);
  });

  it('пересчитывает рублёвую стоимость polza в доллары по курсу', async () => {
    const upstream = jest
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'gen-rub-1', usage: { cost_rub: 0.00036855 } }));
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.polza);

    await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    await flushMicrotasks();
    expect(takeCapturedCost('gen-rub-1')).toBeCloseTo(0.00036855 / DEFAULT_RUB_PER_USD, 12);
  });

  /**
   * polza отдаёт и `cost_rub`, и `cost`, оба в рублях. Прочитать её `cost` как
   * доллары значило бы завысить расход примерно в 86 раз.
   */
  it('читает cost как рубли, когда polza не прислала cost_rub', async () => {
    const upstream = jest
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'gen-rub-2', usage: { cost: 0.5 } }));
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.polza);

    await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: false }),
    });

    await flushMicrotasks();
    expect(takeCapturedCost('gen-rub-2')).toBeCloseTo(0.5 / DEFAULT_RUB_PER_USD, 12);
  });

  it('берёт курс из RUB_PER_USD', async () => {
    const previous = process.env.RUB_PER_USD;
    process.env.RUB_PER_USD = '100';
    try {
      const upstream = jest
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'gen-rub-3', usage: { cost_rub: 10 } }));
      const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.polza);

      await wrapped('https://polza.ai/api/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'x', stream: false }),
      });

      await flushMicrotasks();
      expect(takeCapturedCost('gen-rub-3')).toBeCloseTo(0.1, 12);
    } finally {
      if (previous === undefined) {
        delete process.env.RUB_PER_USD;
      } else {
        process.env.RUB_PER_USD = previous;
      }
    }
  });

  it('не клонирует и не читает тело, если оно не поддерживает getReader (node-fetch Readable)', async () => {
    const realResponse = new Response('irrelevant', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    const fakeNodeReadable = { pipe: jest.fn() };
    Object.defineProperty(realResponse, 'body', { value: fakeNodeReadable, configurable: true });
    const cloneSpy = jest.spyOn(realResponse, 'clone');
    const upstream = jest.fn().mockResolvedValue(realResponse);
    const wrapped = wrapFetchWithCostCapture(upstream, AI_PROVIDERS.openrouter);

    const response = await wrapped('https://polza.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', stream: true }),
    });

    expect(cloneSpy).not.toHaveBeenCalled();
    expect(response).toBe(realResponse);
  });
});
