import { createDlpFetch, DlpFailureError } from './fetch';
import { createDlpAudit } from './audit';
import { DEFAULT_DLP_CONFIG } from 'librechat-data-provider';

const config = { ...DEFAULT_DLP_CONFIG, enabled: true };

function contextWith(recordAuditEntry = jest.fn().mockResolvedValue(undefined)) {
  return {
    config,
    userId: 'u1',
    userName: 'Иван Иванов',
    conversationId: 'c1',
    audit: createDlpAudit({ recordAuditEntry }),
  };
}

function jsonRequest(body: unknown): Request {
  return new Request('https://gateway.test/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function capturingFetch(): { fetch: typeof fetch; sent: () => string } {
  let sent = '';
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    sent = init?.body != null ? String(init.body) : await (input as Request).clone().text();
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ок' } }] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: impl as unknown as typeof fetch, sent: () => sent };
}

describe('createDlpFetch', () => {
  it('маскирует содержимое перед отправкой', async () => {
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(), base.fetch);
    await dlpFetch(
      jsonRequest({ messages: [{ role: 'user', content: 'карта 4111111111111111' }] }),
    );
    expect(base.sent()).toContain('CARD_1');
    expect(base.sent()).not.toContain('4111111111111111');
  });

  it('дописывает инструкцию о маркерах', async () => {
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(), base.fetch);
    await dlpFetch(
      jsonRequest({
        messages: [
          { role: 'system', content: 'ты помощник' },
          { role: 'user', content: 'карта 4111111111111111' },
        ],
      }),
    );
    expect(base.sent()).toContain('заглушки скрытых данных');
  });

  it('разворачивает маркеры в обычном ответе', async () => {
    const impl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'по [CARD_1] лимит' } }] }), {
        headers: { 'content-type': 'application/json' },
      });
    const dlpFetch = createDlpFetch(contextWith(), impl as unknown as typeof fetch);
    const response = await dlpFetch(
      jsonRequest({ messages: [{ role: 'user', content: 'карта 4111111111111111' }] }),
    );
    expect(await response.text()).toContain('4111111111111111');
  });

  it('не отправляет запрос, если маскирование упало', async () => {
    const maskModule = jest.requireActual('./mask') as typeof import('./mask');
    const spy = jest.spyOn(maskModule, 'maskText').mockImplementation(() => {
      throw new Error('detector exploded');
    });
    const base = jest.fn() as unknown as typeof fetch;
    const dlpFetch = createDlpFetch(contextWith(), base);
    await expect(
      dlpFetch(jsonRequest({ messages: [{ role: 'user', content: 'текст' }] })),
    ).rejects.toBeInstanceOf(DlpFailureError);
    expect(base).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('пишет аварию в журнал, когда маскирование упало', async () => {
    const maskModule = jest.requireActual('./mask') as typeof import('./mask');
    const spy = jest.spyOn(maskModule, 'maskText').mockImplementation(() => {
      throw new Error('detector exploded');
    });
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const dlpFetch = createDlpFetch(
      contextWith(recordAuditEntry),
      jest.fn() as unknown as typeof fetch,
    );
    await expect(
      dlpFetch(jsonRequest({ messages: [{ role: 'user', content: 'текст' }] })),
    ).rejects.toBeInstanceOf(DlpFailureError);
    expect(recordAuditEntry.mock.calls[0][0].action).toBe('dlp.failed');
    spy.mockRestore();
  });

  it('пропускает запрос без изменений, когда модуль выключен', async () => {
    const base = capturingFetch();
    const context = { ...contextWith(), config: { ...config, enabled: false } };
    const dlpFetch = createDlpFetch(context, base.fetch);
    await dlpFetch(
      jsonRequest({ messages: [{ role: 'user', content: 'карта 4111111111111111' }] }),
    );
    expect(base.sent()).toContain('4111111111111111');
  });

  it('пишет находки в журнал', async () => {
    const recordAuditEntry = jest.fn().mockResolvedValue(undefined);
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(recordAuditEntry), base.fetch);
    await dlpFetch(
      jsonRequest({ messages: [{ role: 'user', content: 'карта 4111111111111111' }] }),
    );
    expect(recordAuditEntry).toHaveBeenCalled();
  });

  it('пропускает запрос, тело которого не разбирается как JSON', async () => {
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(), base.fetch);
    const request = new Request('https://gateway.test/v1/models', { method: 'GET' });
    await expect(dlpFetch(request)).resolves.toBeDefined();
  });
});

describe('createDlpFetch — инструкция о маркерах', () => {
  it('не дописывает инструкцию, когда маскировать было нечего', async () => {
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(), base.fetch);

    await dlpFetch(jsonRequest({ messages: [{ role: 'user', content: '11' }] }));

    expect(base.sent()).not.toContain('заглушки скрытых данных');
    expect(base.sent()).not.toContain('CARD_1');
  });

  it('перечисляет в инструкции только выданные маркеры', async () => {
    const base = capturingFetch();
    const dlpFetch = createDlpFetch(contextWith(), base.fetch);

    await dlpFetch(jsonRequest({ messages: [{ role: 'user', content: 'ИНН 7707083893' }] }));

    expect(base.sent()).toContain('заглушки скрытых данных');
    expect(base.sent()).toContain('INN_1');
    expect(base.sent()).not.toContain('CARD_1');
  });
});

describe('createDlpFetch — нерешённые маркеры', () => {
  it('предупреждает в журнале, когда маркер из ответа не удалось развернуть', async () => {
    const { logger } = jest.requireActual('@librechat/data-schemas');
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    const impl = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '[CARD_9]' } }] }), {
        headers: { 'content-type': 'application/json' },
      });
    const dlpFetch = createDlpFetch(contextWith(), impl as unknown as typeof fetch);

    const response = await dlpFetch(jsonRequest({ messages: [{ role: 'user', content: '11' }] }));

    expect(await response.text()).toContain('[CARD_9]');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('не удалось развернуть'));
    warnSpy.mockRestore();
  });
});
