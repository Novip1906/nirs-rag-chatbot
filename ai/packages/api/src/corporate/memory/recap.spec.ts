import { ContentTypes } from 'librechat-data-provider';
import type { RecapDeps, RecapJob, RecapMessage } from './recap';
import {
  shouldRecapTurn,
  RECAP_SYSTEM_PROMPT,
  runConversationRecap,
  collectRecapMessages,
  buildRecapTranscript,
  scheduleConversationRecap,
} from './recap';
import {
  endpoint,
  usageDeps,
  completion,
  jsonResponse,
  appConfigWith,
  capturingFetch,
  isolateProviderEnv,
} from './__tests__/helpers/fixtures';

isolateProviderEnv();

const at = new Date('2026-09-25T10:00:00Z');

function recapDeps(fetchImpl: typeof fetch, previous: string | null = null) {
  const deps = {
    ...usageDeps(),
    getConversationRecap: jest.fn(async () =>
      previous == null ? null : { text: previous, at: new Date('2026-09-24T10:00:00Z') },
    ),
    setConversationRecap: jest.fn(async () => true),
    fetchImpl,
  };
  return deps satisfies RecapDeps;
}

function job(messages: RecapMessage[], overrides: Partial<RecapJob> = {}): RecapJob {
  return {
    appConfig: appConfigWith(),
    userId: 'user-1',
    userName: 'Иван',
    conversationId: 'convo-1',
    messageId: 'resp-1',
    messages,
    at,
    ...overrides,
  };
}

const shortChat: RecapMessage[] = [
  { isCreatedByUser: true, text: 'Посчитай тариф для ООО «Ромашка» на 1,2 млн' },
  { isCreatedByUser: false, text: 'Тариф 1,8%, комиссия 21 600 ₽' },
];

function longChat(count: number, size: number): RecapMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    isCreatedByUser: index % 2 === 0,
    text: `сообщение ${index} ${'x'.repeat(size)}`,
  }));
}

describe('collectRecapMessages', () => {
  it('берёт текст сообщений, ответ агента из content без рассуждений и пропускает пустые', () => {
    const messages = collectRecapMessages({
      currentMessages: [
        { messageId: 'u1', isCreatedByUser: true, text: '  Первый вопрос ' },
        { messageId: 'a1', isCreatedByUser: false, text: '', content: [] },
        {
          messageId: 'a2',
          isCreatedByUser: false,
          text: '',
          content: [
            { type: ContentTypes.THINK, think: 'размышления' },
            { type: ContentTypes.TEXT, text: 'Прошлый ответ' },
          ],
        },
        null,
        { messageId: 'u2', isCreatedByUser: true, text: 'Второй вопрос' },
      ],
      response: {
        messageId: 'resp-1',
        text: '',
        content: [
          { type: ContentTypes.THINK, think: 'думаю' },
          { type: ContentTypes.TEXT, text: 'Новый ответ' },
        ],
      },
    });

    expect(messages).toEqual([
      { isCreatedByUser: true, text: 'Первый вопрос' },
      { isCreatedByUser: false, text: 'Прошлый ответ' },
      { isCreatedByUser: true, text: 'Второй вопрос' },
      { isCreatedByUser: false, text: 'Новый ответ' },
    ]);
  });

  it('не берёт рассуждения из text прерванных ответов, если есть content', () => {
    const messages = collectRecapMessages({
      currentMessages: [
        { messageId: 'u1', isCreatedByUser: true, text: 'Вопрос' },
        {
          messageId: 'a1',
          isCreatedByUser: false,
          text: 'размышления о тарифе Частичный ответ',
          content: [
            { type: ContentTypes.THINK, think: 'размышления о тарифе' },
            { type: ContentTypes.TEXT, text: 'Частичный ответ' },
          ],
        },
        {
          messageId: 'a2',
          isCreatedByUser: false,
          text: 'только размышления',
          content: [{ type: ContentTypes.THINK, think: 'только размышления' }],
        },
      ],
      response: {
        messageId: 'resp-1',
        text: 'думаю Ответ',
        content: [
          { type: ContentTypes.THINK, think: 'думаю' },
          { type: ContentTypes.TEXT, text: 'Ответ' },
        ],
      },
    });

    expect(messages).toEqual([
      { isCreatedByUser: true, text: 'Вопрос' },
      { isCreatedByUser: false, text: 'Частичный ответ' },
      { isCreatedByUser: false, text: 'Ответ' },
    ]);
  });

  it('убирает старую копию ответа при правке, оставляя новый ответ', () => {
    const messages = collectRecapMessages({
      currentMessages: [
        { messageId: 'u1', isCreatedByUser: true, text: 'Вопрос' },
        { messageId: 'resp-1', isCreatedByUser: false, text: 'Старый ответ' },
      ],
      response: { messageId: 'resp-1', text: 'Исправленный ответ' },
    });

    expect(messages).toEqual([
      { isCreatedByUser: true, text: 'Вопрос' },
      { isCreatedByUser: false, text: 'Исправленный ответ' },
    ]);
  });

  it('без ветки и ответа возвращает пустой список', () => {
    expect(collectRecapMessages({})).toEqual([]);
  });
});

describe('buildRecapTranscript', () => {
  it('без сообщений сотрудника возвращает null', () => {
    expect(buildRecapTranscript({ messages: [] })).toBeNull();
    expect(
      buildRecapTranscript({ messages: [{ isCreatedByUser: false, text: 'Приветствие агента' }] }),
    ).toBeNull();
  });

  it('короткую беседу отдаёт целиком по ролям', () => {
    expect(buildRecapTranscript({ messages: shortChat })).toBe(
      'Сотрудник: Посчитай тариф для ООО «Ромашка» на 1,2 млн\nАссистент: Тариф 1,8%, комиссия 21 600 ₽',
    );
  });

  it('при длинной беседе оставляет первое сообщение и хвост, отмечает пропуск и добавляет прежний конспект', () => {
    const messages = longChat(12, 2_000);

    const transcript = buildRecapTranscript({ messages, previousRecap: 'Обсуждали договор' })!;

    expect(
      transcript.startsWith('Прежний конспект беседы: Обсуждали договор\n\nСотрудник: сообщение 0'),
    ).toBe(true);
    expect(transcript).toMatch(/пропущено сообщений: \d+/);
    expect(transcript).toContain('сообщение 11');
    expect(transcript).not.toContain('сообщение 1 ');
    expect(transcript.length).toBeLessThan(13_000);
  });

  it('обрезает слишком длинные сообщения, оставляя начало и конец', () => {
    const transcript = buildRecapTranscript({
      messages: [
        { isCreatedByUser: true, text: `НАЧАЛО ${'a'.repeat(10_000)} КОНЕЦ` },
        { isCreatedByUser: false, text: 'ответ' },
      ],
    })!;

    expect(transcript).toMatch(/^Сотрудник: НАЧАЛО a+ … a+ КОНЕЦ\n/);
    expect(transcript).toContain('Ассистент: ответ');
    expect(transcript.length).toBeLessThan(3_100);
  });
});

describe('runConversationRecap', () => {
  it('пишет конспект по ответу модели с меткой хода и расход chat_recap', async () => {
    const { fetchImpl, calls } = capturingFetch(
      jsonResponse(completion('  Считали тариф для «Ромашки»:  1,8%. ', { cost: 0.0001 })),
    );
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(deps, job(shortChat));

    expect(calls).toHaveLength(1);
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: RECAP_SYSTEM_PROMPT },
      { role: 'user', content: buildRecapTranscript({ messages: shortChat }) },
    ]);
    expect(deps.getConversationRecap).not.toHaveBeenCalled();
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        scenario: 'chat_recap',
        conversationId: 'convo-1',
        messageId: 'resp-1',
        costUsd: 0.0001,
      }),
    );
    expect(deps.setConversationRecap).toHaveBeenCalledWith({
      user: 'user-1',
      conversationId: 'convo-1',
      text: 'Считали тариф для «Ромашки»: 1,8%.',
      at,
      messageId: 'resp-1',
    });
  });

  it('на SKIP ничего не пишет, но расход учитывает', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('SKIP')));
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(deps, job(shortChat));

    expect(deps.recordUsage).toHaveBeenCalledTimes(1);
    expect(deps.setConversationRecap).not.toHaveBeenCalled();
  });

  it('на обрезанном ответе ничего не пишет, но расход учитывает', async () => {
    const { fetchImpl } = capturingFetch(
      jsonResponse(completion('Незаконченный конспект', { cost: 0.001 }, 'length')),
    );
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(deps, job(shortChat));

    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: 'chat_recap', costUsd: 0.001 }),
    );
    expect(deps.setConversationRecap).not.toHaveBeenCalled();
  });

  it('читает прежний конспект, только если середина беседы не влезла', async () => {
    const { fetchImpl, calls } = capturingFetch(jsonResponse(completion('Новый конспект')));
    const deps = recapDeps(fetchImpl, 'Договорились о тарифе 1,8%');

    await runConversationRecap(deps, job(longChat(12, 2_000)));

    expect(deps.getConversationRecap).toHaveBeenCalledWith({
      user: 'user-1',
      conversationId: 'convo-1',
    });
    const prompt = (calls[0].body.messages as Array<{ content: string }>)[1].content;
    expect(prompt).toContain('Прежний конспект беседы: Договорились о тарифе 1,8%');
    expect(deps.setConversationRecap).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Новый конспект' }),
    );
  });

  it('обрезает слишком длинный конспект', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('я'.repeat(2_000))));
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(deps, job(shortChat));

    const [{ text }] = deps.setConversationRecap.mock.calls[0] as unknown as [{ text: string }];
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('без модели для служебных вызовов ничего не делает', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('Конспект')));
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(
      deps,
      job(shortChat, {
        appConfig: appConfigWith([endpoint('OpenRouter', { titleModel: undefined })]),
      }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.recordUsage).not.toHaveBeenCalled();
    expect(deps.setConversationRecap).not.toHaveBeenCalled();
  });

  it('без сообщений сотрудника не зовёт модель', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('Конспект')));
    const deps = recapDeps(fetchImpl);

    await runConversationRecap(deps, job([{ isCreatedByUser: false, text: 'Привет' }]));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('не бросает при сбое модели, чтения или записи конспекта', async () => {
    const failing = capturingFetch(new Error('network down'));
    const httpError = capturingFetch(jsonResponse({}, 500));
    const ok = capturingFetch(jsonResponse(completion('Конспект')));
    const brokenWrite = recapDeps(ok.fetchImpl);
    brokenWrite.setConversationRecap.mockRejectedValueOnce(new Error('db down'));
    const brokenRead = recapDeps(ok.fetchImpl);
    brokenRead.getConversationRecap.mockRejectedValueOnce(new Error('db down'));

    await expect(
      runConversationRecap(recapDeps(failing.fetchImpl), job(shortChat)),
    ).resolves.toBeUndefined();
    await expect(
      runConversationRecap(recapDeps(httpError.fetchImpl), job(shortChat)),
    ).resolves.toBeUndefined();
    await expect(runConversationRecap(brokenWrite, job(shortChat))).resolves.toBeUndefined();
    await expect(
      runConversationRecap(brokenRead, job(longChat(12, 2_000))),
    ).resolves.toBeUndefined();
    expect(brokenRead.setConversationRecap).toHaveBeenCalled();
  });
});

describe('shouldRecapTurn', () => {
  const memoryAgent = { id: 'agent-1', memoryToolsRegistered: true };
  const turn = (overrides: Partial<Parameters<typeof shouldRecapTurn>[0]> = {}) => ({
    req: { body: {} },
    agent: memoryAgent,
    response: {},
    conversation: {},
    isTemporary: false,
    ...overrides,
  });

  it('конспектирует обычный завершённый ход агента с памятью', () => {
    expect(shouldRecapTurn(turn())).toBe(true);
  });

  it.each([
    ['агент без инструментов памяти', { agent: { id: 'agent-1', memoryToolsRegistered: false } }],
    ['временный чат', { isTemporary: true }],
    ['ветка субагента', { conversation: { subagentThread: { parentConversationId: 'p' } } }],
    ['ответ с ошибкой', { response: { error: true } }],
    ['незавершённый ответ', { response: { unfinished: true } }],
    ['запуск по расписанию', { req: { body: {}, _isScheduledFire: true } }],
    [
      'событийный запуск',
      { req: { body: {}, _agentEventBindingRetention: { isTemporary: false, expiredAt: null } } },
    ],
  ])('не конспектирует: %s', (_label, overrides) => {
    expect(shouldRecapTurn(turn(overrides))).toBe(false);
  });
});

describe('scheduleConversationRecap', () => {
  it('запускает конспект в фоне, не задерживая вызывающего', async () => {
    const { fetchImpl } = capturingFetch(jsonResponse(completion('Конспект')));
    const deps = recapDeps(fetchImpl);

    const written = new Promise<void>((resolve) => {
      deps.setConversationRecap.mockImplementationOnce(async () => {
        resolve();
        return true;
      });
    });

    const returned = scheduleConversationRecap(deps, job(shortChat));

    expect(returned).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    await written;
    expect(deps.setConversationRecap).toHaveBeenCalledTimes(1);
  });
});
