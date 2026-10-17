import { concat } from '@langchain/core/utils/stream';
import { getChatModelClass, Providers } from '@librechat/agents';
import type { AIMessageChunk } from '@langchain/core/messages';
import { applyMissingStreamRoleFix } from '~/corporate/streamRole';

/**
 * Сборка потокового вызова инструмента на OpenAI-совместимом шлюзе (polza.ai,
 * модель openai/gpt-5.6-luna) — против НАСТОЯЩЕГО класса из @librechat/agents,
 * без подделок разбора чанков.
 *
 * Провайдер отдаёт вызов в классическом OpenAI-стиле: сначала «шапка» с id и
 * именем без `arguments`, затем аргументы кусками. Проверяются два способа
 * потерять такой вызов целиком:
 *
 * 1. Первый чанк потока без `role` — конвертер уходит в ветку ChatMessageChunk,
 *    которая `tool_call_chunks` не переносит вовсе. Это чинит
 *    `applyMissingStreamRoleFix`; тест держит правку связанной с реальным
 *    устройством библиотеки, а не с макетом.
 * 2. Повторная «шапка» того же вызова: `_mergeDicts` склеивает ДВА набора
 *    аргументов в одну строку `{...}{...}`, `parsePartialJson` возвращает
 *    `null`, и вызов уезжает в `invalid_tool_calls` — `tool_calls` пустой,
 *    инструмент не исполняется, ход заканчивается без текста.
 *
 * Gemini и Claude через тот же шлюз не задеты: они шлют роль сразу и отдают
 * `arguments` целиком одной дельтой.
 */

type Delta = Record<string, unknown>;

interface RawToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

const chunk = (delta: Delta, finish_reason: string | null = null) => ({
  id: 'chatcmpl-luna',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'openai/gpt-5.6-luna',
  choices: [{ index: 0, delta, finish_reason, logprobs: null }],
});

const toolDelta = (calls: RawToolCallDelta[]) => chunk({ tool_calls: calls });

const ROLE = chunk({ role: 'assistant', content: '' });
const DONE = chunk({}, 'tool_calls');

/** Шапка вызова: id и имя без поля `arguments` — так их шлёт gpt-5.6-luna. */
const header = (id: string): RawToolCallDelta => ({
  index: 0,
  id,
  type: 'function',
  function: { name: 'knowledge_search' },
});

const args = (fragment: string): RawToolCallDelta => ({
  index: 0,
  function: { arguments: fragment },
});

const knowledgeSearchTool = {
  type: 'function' as const,
  function: {
    name: 'knowledge_search',
    description: 'Поиск по базе знаний',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
};

async function accumulate(rawChunks: ReturnType<typeof chunk>[]): Promise<AIMessageChunk> {
  const ChatOpenAI = getChatModelClass(Providers.OPENAI) as unknown as new (fields: unknown) => {
    client?: unknown;
    completions?: { client?: unknown };
    bindTools(tools: unknown[]): { stream(input: unknown): Promise<AsyncIterable<AIMessageChunk>> };
  };

  const model = new ChatOpenAI({
    model: 'openai/gpt-5.6-luna',
    apiKey: 'test',
    streaming: true,
    configuration: { baseURL: 'https://polza.ai/api/v1' },
  });

  const client = {
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            for (const raw of rawChunks) {
              yield raw;
            }
          })(),
      },
    },
  };
  model.client = client;
  if (model.completions) {
    model.completions.client = client;
  }

  const bound = model.bindTools([knowledgeSearchTool]);
  let final: AIMessageChunk | undefined;
  for await (const messageChunk of await bound.stream([{ role: 'user', content: 'какая ставка?' }])) {
    final = final === undefined ? messageChunk : (concat(final, messageChunk) as AIMessageChunk);
  }
  return final as AIMessageChunk;
}

describe('сборка потоковых аргументов вызова инструмента (polza.ai / gpt-5.6-luna)', () => {
  it('одна шапка вызова: аргументы собираются, вызов исполнимый', async () => {
    const final = await accumulate([
      ROLE,
      toolDelta([header('call_X')]),
      toolDelta([args('{"')]),
      toolDelta([args('query')]),
      toolDelta([args('":"')]),
      toolDelta([args('ставка')]),
      toolDelta([args('"}')]),
      DONE,
    ]);

    expect(final.tool_calls).toEqual([
      { name: 'knowledge_search', args: { query: 'ставка' }, id: 'call_X', type: 'tool_call' },
    ]);
    expect(final.invalid_tool_calls).toEqual([]);
  });

  it('повторная шапка того же вызова: аргументы склеиваются и вызов теряется', async () => {
    const final = await accumulate([
      ROLE,
      toolDelta([header('call_X')]),
      toolDelta([args('{"query":"ставка"}')]),
      toolDelta([header('call_X')]),
      toolDelta([args('{"query":"тариф"}')]),
      DONE,
    ]);

    // Ровно то, что видно в проде: вызова нет, есть один invalid с именем и id,
    // а аргументы — две склеенные JSON-строки.
    expect(final.tool_calls).toEqual([]);
    expect(final.invalid_tool_calls).toEqual([
      {
        name: 'knowledge_search',
        args: '{"query":"ставка"}{"query":"тариф"}',
        id: 'call_X',
        error: 'Malformed args.',
        type: 'invalid_tool_call',
      },
    ]);

    // Имя и id при этом целы — в интерфейсе карточка инструмента рисуется по ним,
    // по одной на каждую шапку в потоке, и обе закрываются как «выполнено».
    expect(final.tool_call_chunks).toEqual([
      {
        name: 'knowledge_search',
        args: '{"query":"ставка"}{"query":"тариф"}',
        id: 'call_X',
        index: 0,
        type: 'tool_call_chunk',
      },
    ]);
  });
});

/**
 * Правка роли проверяется на настоящем классе, а не на макете разбора чанков:
 * иначе она переживёт любое изменение внутреннего устройства библиотеки —
 * переименование метода, перенос конвертации, починку дефекта апстримом — и
 * тихо перестанет действовать, а тесты останутся зелёными.
 *
 * Порядок проверок важен: правка меняет прототип на весь процесс, поэтому
 * состояние «без правки» снимается первым.
 */
describe('applyMissingStreamRoleFix на настоящем классе провайдера', () => {
  /** Поток рассуждающей модели: роли нет ни в одном чанке. */
  const withoutRole = [
    chunk({ content: '' }),
    toolDelta([header('call_X')]),
    toolDelta([args('{"query":"ставка"}')]),
    DONE,
  ];

  it('без правки вызов инструмента теряется целиком — дефект жив', async () => {
    const final = await accumulate(withoutRole);

    expect(final.tool_calls ?? []).toEqual([]);
    expect(final.tool_call_chunks ?? []).toEqual([]);
  });

  it('после правки вызов собирается с аргументами', async () => {
    applyMissingStreamRoleFix();
    const final = await accumulate(withoutRole);

    expect(final.tool_calls).toEqual([
      { name: 'knowledge_search', args: { query: 'ставка' }, id: 'call_X', type: 'tool_call' },
    ]);
  });
});
