import { AIMessageChunk, ChatMessageChunk } from '@langchain/core/messages';
import { applyMissingStreamRoleFix } from './streamRole';

/**
 * Подделка разбора чанков: воспроизводит то самое поведение библиотеки, из-за которого
 * терялись вызовы инструментов, — тип сообщения выбирается по роли, и без роли получается
 * «сообщение неизвестной роли», в котором вызовов инструментов нет вовсе.
 */
class FakeCompletions {
  _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, unknown>,
    _rawResponse: unknown,
    defaultRole?: string,
  ): AIMessageChunk | ChatMessageChunk {
    const role = (delta.role as string | undefined) ?? defaultRole;
    const rawToolCalls = (delta.tool_calls ?? []) as Array<{
      id?: string;
      index?: number;
      function?: { name?: string; arguments?: string };
    }>;
    if (role === 'assistant') {
      return new AIMessageChunk({
        content: '',
        tool_call_chunks: rawToolCalls.map((call) => ({
          name: call.function?.name,
          args: call.function?.arguments,
          id: call.id,
          index: call.index,
          type: 'tool_call_chunk' as const,
        })),
      });
    }
    return new ChatMessageChunk({ content: '', role: role ?? 'unknown' });
  }
}

const mockChatModelClass = jest.fn();

jest.mock('@librechat/agents', () => ({
  Providers: { OPENAI: 'openAI' },
  getChatModelClass: () => mockChatModelClass(),
}));

const argumentsChunk = { tool_calls: [{ index: 0, function: { arguments: '{"query":"отпуск"}' } }] };

describe('applyMissingStreamRoleFix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChatModelClass.mockImplementation(() => {
      class ChatModel {
        completions = new FakeCompletions();
      }
      return ChatModel;
    });
  });

  it('без правки чанк без роли теряет вызов инструмента — воспроизводит дефект', () => {
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(argumentsChunk, {}, undefined);

    expect(chunk).toBeInstanceOf(ChatMessageChunk);
    expect((chunk as AIMessageChunk).tool_call_chunks).toBeUndefined();
  });

  it('после правки чанк без роли разбирается как ответ ассистента с аргументами вызова', () => {
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(argumentsChunk, {}, undefined);

    expect(chunk).toBeInstanceOf(AIMessageChunk);
    expect((chunk as AIMessageChunk).tool_call_chunks).toEqual([
      { name: undefined, args: '{"query":"отпуск"}', id: undefined, index: 0, type: 'tool_call_chunk' },
    ]);
  });

  it('роль из самого чанка правка не подменяет', () => {
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(
      { role: 'tool', content: 'результат' },
      {},
      undefined,
    );

    expect(chunk).toBeInstanceOf(ChatMessageChunk);
  });

  /** Правка ставится на общий прототип, поэтому повторный вызов не должен наслаивать обёртки. */
  it('повторное применение ничего не ломает', () => {
    applyMissingStreamRoleFix();
    applyMissingStreamRoleFix();
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(argumentsChunk, {}, undefined);

    expect(chunk).toBeInstanceOf(AIMessageChunk);
  });

  /**
   * Пустая роль в дельте страшнее отсутствующей: разбор запоминает её и подставляет
   * во все следующие чанки, поэтому одной такой дельты хватило бы, чтобы правка
   * перестала действовать до конца потока.
   */
  it('пустую роль в чанке считает отсутствующей', () => {
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(
      { ...argumentsChunk, role: '' },
      {},
      undefined,
    );

    expect(chunk).toBeInstanceOf(AIMessageChunk);
  });

  it('пустую роль, запомненную с прошлого чанка, тоже считает отсутствующей', () => {
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();

    const chunk = completions._convertCompletionsDeltaToBaseMessageChunk(argumentsChunk, {}, '');

    expect(chunk).toBeInstanceOf(AIMessageChunk);
  });

  it('исходную дельту не меняет', () => {
    applyMissingStreamRoleFix();
    const completions = new FakeCompletions();
    const delta = { ...argumentsChunk, role: '' };

    completions._convertCompletionsDeltaToBaseMessageChunk(delta, {}, undefined);

    expect(delta.role).toBe('');
  });

  it('не падает, когда разбор чанков устроен иначе, чем ожидалось', () => {
    mockChatModelClass.mockImplementation(() => {
      class ChatModel {
        completions = {};
      }
      return ChatModel;
    });

    expect(() => applyMissingStreamRoleFix()).not.toThrow();
  });
});
