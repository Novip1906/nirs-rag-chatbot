import { ErrorTypes, AttachmentErrorCodes } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { AgentDocumentSource } from './fit';
import {
  assessDocumentFit,
  resolveUploadBudget,
  resolveDocumentBudget,
  resolveModelContextLimit,
  resolveAgentDocumentBudget,
  assertAttachmentsFitContext,
  MAX_OBSERVED_CHARS_PER_TOKEN,
  DOCUMENT_CONTEXT_RESERVE_TOKENS,
} from './fit';

const specConfig = (preset: { endpoint: string; model?: string; maxContextTokens?: number }) =>
  ({
    modelSpecs: {
      list: [{ name: 'claude-sonnet-5', label: 'Claude Sonnet 5', preset }],
    },
  }) as AppConfig;

describe('resolveDocumentBudget', () => {
  it('оставляет под документ контекст без 5% и резерва', () => {
    expect(DOCUMENT_CONTEXT_RESERVE_TOKENS).toBe(8000);
    expect(resolveDocumentBudget(1000000).budget).toBe(942000);
  });

  it('вычитает максимальный ответ модели', () => {
    expect(resolveDocumentBudget(1000000, 64000).budget).toBe(878000);
  });

  it('считает наименьший контекст, в который документ поместится', () => {
    expect(resolveDocumentBudget(1000000, 64000).requiredContextTokens(900000)).toBe(1023158);
  });
});

describe('assessDocumentFit', () => {
  const budget = resolveDocumentBudget(1000000, 64000);

  it('отклоняет документ больше бюджета с параметрами для подсказки модели', async () => {
    const fit = await assessDocumentFit({ tokenCount: 900000, budget, filename: 'Договор.pdf' });

    expect(fit.tokenCount).toBe(900000);
    expect(fit.rejection).toEqual({
      message: expect.stringContaining('Договор.pdf'),
      errorCode: AttachmentErrorCodes.context_overflow,
      params: {
        filename: 'Договор.pdf',
        tokens: 900000,
        contextTokens: 1000000,
        requiredContextTokens: 1023158,
      },
    });
  });

  it('пропускает документ, который помещается', async () => {
    const fit = await assessDocumentFit({ tokenCount: 500000, budget, filename: 'note.docx' });

    expect(fit).toEqual({ tokenCount: 500000, rejection: null });
  });

  it('отклоняет огромный текст по оценке знаков, не считая токены', async () => {
    const countTokens = jest.fn((text: string) => Promise.resolve(text.length));
    const text = 'x'.repeat(20_000_000);

    const fit = await assessDocumentFit({ text, budget, filename: 'huge.txt', countTokens });

    expect(countTokens).not.toHaveBeenCalled();
    expect(fit.tokenCount).toBe(Math.ceil(20_000_000 / MAX_OBSERVED_CHARS_PER_TOKEN));
    expect(fit.rejection?.errorCode).toBe(AttachmentErrorCodes.context_overflow);
  });

  it('делит знаки на максимальное наблюдённое соотношение 5.85', () => {
    expect(MAX_OBSERVED_CHARS_PER_TOKEN).toBe(5.85);
  });

  it('решает по точному счёту, когда оценка по знакам бюджет не превысила', async () => {
    const countTokens = jest.fn(() => Promise.resolve(900000));

    const fit = await assessDocumentFit({
      text: 'x'.repeat(1_000_000),
      budget,
      filename: 'dense.txt',
      countTokens,
    });

    expect(countTokens).toHaveBeenCalledTimes(1);
    expect(fit.tokenCount).toBe(900000);
    expect(fit.rejection?.params.requiredContextTokens).toBe(1023158);
  });

  it('несёт в отказе число страниц, когда оно известно', async () => {
    const fit = await assessDocumentFit({
      tokenCount: 900000,
      pageCount: 3489,
      budget,
      filename: 'scan.pdf',
    });

    expect(fit.rejection?.params.pageCount).toBe(3489);
  });
});

describe('resolveModelContextLimit', () => {
  it('не знает контекста неизвестной модели и не подставляет значение по умолчанию', () => {
    expect(
      resolveModelContextLimit({ endpoint: 'openAI', model: 'totally-unknown-model-xyz' }),
    ).toBeUndefined();
  });

  it('не знает контекста без модели', () => {
    expect(resolveModelContextLimit({ endpoint: 'openAI' })).toBeUndefined();
  });

  it('берёт maxContextTokens из пресета спека', () => {
    const appConfig = specConfig({
      endpoint: 'anthropic',
      model: 'claude-sonnet-5',
      maxContextTokens: 200000,
    });

    expect(resolveModelContextLimit({ spec: 'claude-sonnet-5', appConfig })).toBe(200000);
  });

  it('берёт контекст модели спека из встроенной таблицы', () => {
    const appConfig = specConfig({ endpoint: 'OpenRouter', model: 'openai/gpt-5.6-luna' });

    expect(resolveModelContextLimit({ spec: 'claude-sonnet-5', appConfig })).toBe(1050000);
  });

  it('предпочитает maxContextTokens запроса', () => {
    expect(
      resolveModelContextLimit({
        endpoint: 'openAI',
        model: 'gpt-5.6-luna',
        maxContextTokens: 5000,
      }),
    ).toBe(5000);
  });

  it('читает контекст из токен-конфига эндпоинта', () => {
    expect(
      resolveModelContextLimit({
        endpoint: 'OpenRouter',
        model: 'vendor/private-model',
        tokenConfig: { 'vendor/private-model': { prompt: 1, completion: 1, context: 300000 } },
      }),
    ).toBe(300000);
  });
});

describe('resolveUploadBudget', () => {
  it('пропускает проверку, когда модель не определена', () => {
    expect(resolveUploadBudget({ endpoint: 'agents' })).toBeUndefined();
  });

  it('строит бюджет по спеку', () => {
    const appConfig = specConfig({
      endpoint: 'anthropic',
      model: 'unknown-output-model',
      maxContextTokens: 1000000,
    });

    const budget = resolveUploadBudget({ spec: 'claude-sonnet-5', appConfig });

    expect(budget?.contextTokens).toBe(1000000);
  });
});

describe('resolveAgentDocumentBudget', () => {
  const agent = (overrides: Partial<AgentDocumentSource> = {}) =>
    ({
      endpoint: 'anthropic',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      model_parameters: { model: 'claude-sonnet-4', maxContextTokens: 1000000 },
      baseContextTokens: 936000,
      ...overrides,
    }) as AgentDocumentSource;

  it('даёт при отправке тот же бюджет, что и при загрузке', () => {
    const upload = resolveUploadBudget({
      endpoint: 'anthropic',
      model: 'claude-sonnet-4',
      maxContextTokens: 1000000,
    });

    const send = resolveAgentDocumentBudget(agent());

    expect(upload?.budget).toBe(878000);
    expect(send?.budget).toBe(upload?.budget);
    expect(send?.contextTokens).toBe(1000000);
  });

  it('совпадает с загрузкой и без явного контекста модели', () => {
    const upload = resolveUploadBudget({ endpoint: 'openAI', model: 'gpt-5.6-luna' });

    const send = resolveAgentDocumentBudget(
      agent({
        endpoint: 'openAI',
        provider: 'openAI',
        model: 'gpt-5.6-luna',
        model_parameters: { model: 'gpt-5.6-luna' },
      }),
    );

    expect(send?.budget).toBe(upload?.budget);
    expect(send?.contextTokens).toBe(1050000);
  });

  it('не отклоняет при отправке документ на границе, который прошёл загрузку', () => {
    const attachments = [
      { filename: 'edge.docx', source: 'text', text: 'текст', tokenCount: 860000 },
    ];

    expect(() =>
      assertAttachmentsFitContext(attachments, resolveAgentDocumentBudget(agent())),
    ).not.toThrow();
  });

  it('несёт в отказе при отправке настоящий контекст модели', () => {
    const attachments = [
      { filename: 'big.docx', source: 'text', text: 'текст', tokenCount: 900000 },
    ];
    let thrown: Error | undefined;
    try {
      assertAttachmentsFitContext(attachments, resolveAgentDocumentBudget(agent()));
    } catch (error) {
      thrown = error as Error;
    }

    const { params } = JSON.parse(thrown?.message ?? '{}');
    expect(params.contextTokens).toBe(1000000);
    expect(params.requiredContextTokens).toBe(1023158);
    expect(params.requiredContextTokens).toBeGreaterThan(params.contextTokens);
  });

  it('берёт посчитанный агентом контекст, когда модель неизвестна', () => {
    const budget = resolveAgentDocumentBudget(
      agent({
        model: 'totally-unknown-model-xyz',
        model_parameters: { model: 'totally-unknown-model-xyz' },
        baseContextTokens: 30000,
      }),
    );

    expect(budget?.budget).toBe(20500);
  });

  it('не строит бюджет без агента', () => {
    expect(resolveAgentDocumentBudget(undefined)).toBeUndefined();
  });

  it('не отклоняет небольшой документ у модели OpenRouter без предела ответа в токен-конфиге', () => {
    const budget = resolveAgentDocumentBudget(
      agent({
        endpoint: 'OpenRouter',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-luna',
        model_parameters: { model: 'openai/gpt-5.6-luna' },
        endpointTokenConfig: {
          'openai/gpt-5.6-luna': { prompt: 0.2, completion: 1.25, context: 1050000 },
        },
      }),
    );
    const attachments = [
      {
        filename: 'transactions-2026-09-14_2026-09-15.xlsx',
        source: 'text',
        text: 'текст',
        tokenCount: 5335,
      },
    ];

    expect(budget?.contextTokens).toBe(1050000);
    expect(budget?.budget).toBeGreaterThan(5335);
    expect(() => assertAttachmentsFitContext(attachments, budget)).not.toThrow();
  });
});

describe('assertAttachmentsFitContext', () => {
  const attachment = (tokenCount: number) => ({
    filename: 'regulation.docx',
    source: 'text',
    text: 'текст',
    tokenCount,
  });
  const budget = resolveDocumentBudget(500000);

  it('бросает ошибку сообщения с типом DOCUMENT_CONTEXT_OVERFLOW', () => {
    let thrown: Error | undefined;
    try {
      assertAttachmentsFitContext([attachment(900000)], budget);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(JSON.parse(thrown?.message ?? '{}')).toEqual({
      type: ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW,
      message: expect.any(String),
      errorCode: AttachmentErrorCodes.context_overflow,
      params: {
        filename: 'regulation.docx',
        tokens: 900000,
        contextTokens: 500000,
        requiredContextTokens: Math.ceil(((900000 + 8000) * 100) / 95),
      },
    });
  });

  it('пропускает вложения, которые помещаются', () => {
    expect(() => assertAttachmentsFitContext([attachment(400000)], budget)).not.toThrow();
  });

  it('суммирует токены всех текстовых вложений сообщения', () => {
    expect(() =>
      assertAttachmentsFitContext([attachment(300000), attachment(300000)], budget),
    ).toThrow(ErrorTypes.DOCUMENT_CONTEXT_OVERFLOW);
  });

  it('не проверяет вложения, которые не являются текстом', () => {
    expect(() =>
      assertAttachmentsFitContext([{ ...attachment(900000), source: 'local' }], budget),
    ).not.toThrow();
  });

  it('пропускает проверку без бюджета', () => {
    expect(() => assertAttachmentsFitContext([attachment(900000)], undefined)).not.toThrow();
  });
});
