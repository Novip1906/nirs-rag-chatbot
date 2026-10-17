import { tool } from '@librechat/agents/langchain/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ToolMessage } from '@langchain/core/messages';
import type { GuardableTool, ToolInvocation } from './args';
import {
  guardToolArguments,
  missingArgumentsMessage,
  missingToolArguments,
  normalizeToolArguments,
} from './args';

const searchSchema = {
  type: 'object' as const,
  properties: { query: { type: 'string' as const, description: 'Ключевые слова для поиска.' } },
  required: ['query'],
};

const listSchema = {
  type: 'object' as const,
  properties: { reason: { type: 'string' as const, description: 'Зачем понадобился список.' } },
};

/** Инструмент строится настоящий, а тип сужается до формы, которую защита и подменяет. */
function buildSearchTool(calls: string[]): GuardableTool<RunnableConfig, ToolMessage> {
  const searchTool = tool(
    async ({ query }: { query: string }) => {
      calls.push(query);
      return `найдено по «${query}»`;
    },
    {
      name: 'knowledge_search',
      responseFormat: 'content',
      description: 'поиск по базе знаний',
      schema: searchSchema,
    },
  );
  return searchTool as GuardableTool<RunnableConfig, ToolMessage>;
}

function invocation(args: ToolInvocation['args']): ToolInvocation {
  return { name: 'knowledge_search', id: 'call-1', type: 'tool_call', args };
}

function contentOf(result: ToolMessage | string): string {
  if (typeof result === 'string') {
    return result;
  }
  return typeof result.content === 'string' ? result.content : '';
}

describe('normalizeToolArguments', () => {
  it('чинит аргументы, присланные строкой с JSON', () => {
    expect(normalizeToolArguments('{"query":"отпуск"}')).toEqual({ query: 'отпуск' });
  });

  it('считает непришедшими пустую строку, мусор и не-объект', () => {
    expect(normalizeToolArguments('')).toBeNull();
    expect(normalizeToolArguments('   ')).toBeNull();
    expect(normalizeToolArguments('не json')).toBeNull();
    expect(normalizeToolArguments('"строка"')).toBeNull();
    expect(normalizeToolArguments(null)).toBeNull();
    expect(normalizeToolArguments(undefined)).toBeNull();
  });
});

describe('missingToolArguments', () => {
  it('считает пустую строку и пробелы отсутствующим значением', () => {
    expect(missingToolArguments({ query: '' }, ['query'])).toEqual(['query']);
    expect(missingToolArguments({ query: '  ' }, ['query'])).toEqual(['query']);
    expect(missingToolArguments({ query: 'ставка' }, ['query'])).toEqual([]);
  });

  it('без обязательных параметров пустые аргументы допустимы', () => {
    expect(missingToolArguments({}, [])).toEqual([]);
    expect(missingToolArguments('', [])).toEqual([]);
  });
});

/**
 * Проверяется не заглушка, а настоящий инструмент LangChain: именно его валидация
 * схемы бросает `ToolInputParsingException` до обработчика, из-за чего вызов с
 * потерянными аргументами возвращает модели ноль символов и ход обрывается молча.
 */
describe('guardToolArguments на настоящем инструменте', () => {
  const rejectedArguments: Array<[string, ToolInvocation['args']]> = [
    ['пустая строка', ''],
    ['пустой объект', {}],
    ['нет обязательного параметра', { reason: 'просто так' }],
    ['неразбираемая строка', '{"query":'],
    ['аргументов нет вовсе', null],
  ];

  const brokenArguments: Array<[string, ToolInvocation['args']]> = [
    ...rejectedArguments,
    ['пустой обязательный параметр', { query: '' }],
  ];

  it.each(rejectedArguments)(
    'без защиты вызов с «%s» не доходит до инструмента',
    async (_label, args) => {
      const calls: string[] = [];
      const unguarded = buildSearchTool(calls);

      await expect(unguarded.invoke(invocation(args))).rejects.toThrow();
      expect(calls).toEqual([]);
    },
  );

  it('без защиты пустой обязательный параметр уходит в поиск как пустой запрос', async () => {
    const calls: string[] = [];
    const unguarded = buildSearchTool(calls);

    await unguarded.invoke(invocation({ query: '' }));

    expect(calls).toEqual(['']);
  });

  it.each(brokenArguments)(
    'с защитой вызов с «%s» возвращает модели инструкцию, а не пустоту',
    async (_label, args) => {
      const calls: string[] = [];
      const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

      const content = contentOf(await guarded.invoke(invocation(args)));

      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('knowledge_search');
      expect(content).toContain('query');
      expect(content).toContain('Повтори вызов');
      expect(calls).toEqual([]);
    },
  );

  it('исправимые аргументы доходят до инструмента как обычно', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    const content = contentOf(await guarded.invoke(invocation('{"query":"ставка"}')));

    expect(calls).toEqual(['ставка']);
    expect(content).toContain('найдено по «ставка»');
  });

  it('целые аргументы проходят насквозь', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    await guarded.invoke(invocation({ query: 'отпуск' }));

    expect(calls).toEqual(['отпуск']);
  });

  /**
   * У инструмента без обязательных параметров пустая строка тоже валит валидацию
   * схемы: чинить её нужно, а требовать от модели нечего.
   */
  it('инструменту без обязательных параметров чинит пустую строку в пустой объект', async () => {
    const calls: number[] = [];
    const listTool = tool(
      async () => {
        calls.push(1);
        return 'список документов';
      },
      {
        name: 'knowledge_list',
        responseFormat: 'content',
        description: 'список документов',
        schema: listSchema,
      },
    ) as GuardableTool<RunnableConfig, ToolMessage>;

    const call: ToolInvocation = { name: 'knowledge_list', id: 'c', type: 'tool_call', args: '' };
    await expect(listTool.invoke(call)).rejects.toThrow();

    const guarded = guardToolArguments(listTool);
    const content = contentOf(await guarded.invoke(call));

    expect(content).toContain('список документов');
    expect(calls).toEqual([1]);
  });
});

/**
 * Второй реальный способ вызвать инструмент: событийный ON_TOOL_EXECUTE
 * (`packages/api/src/agents/handlers.ts`) вызывает `tool.invoke(rawArgs, config)`
 * без обёртки — сами аргументы приходят прямо в `input`, а id вызова лежит в
 * `config.toolCall.id`. Гвард, написанный под форму ToolNode (`input.args`),
 * в этом случае читал несуществующее поле и считал аргументы потерянными
 * всегда, для любого вызова `knowledge_search` — это и было причиной прод-бага.
 */
describe('guardToolArguments в форме ON_TOOL_EXECUTE (аргументы без обёртки, id в config.toolCall)', () => {
  const toolExecuteConfig = (id: string) =>
    ({ toolCall: { id, name: 'knowledge_search' } }) as unknown as RunnableConfig;

  it('целые аргументы без обёртки доходят до инструмента, результат читается через .content', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    const result = await guarded.invoke({ query: 'ставка' }, toolExecuteConfig('call-1'));

    expect(calls).toEqual(['ставка']);
    expect(typeof result).not.toBe('string');
    expect(contentOf(result)).toContain('найдено по «ставка»');
  });

  it('без обязательного параметра гвард срабатывает и отдаёт объект с .content, а не голую строку', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    const result = await guarded.invoke({}, toolExecuteConfig('call-2'));

    expect(calls).toEqual([]);
    expect(typeof result).not.toBe('string');
    const content = contentOf(result);
    expect(content).toContain('knowledge_search');
    expect(content).toContain('query');
    expect(content).toContain('Повтори вызов');
  });

  it('JSON-строкой присланные аргументы без обёртки тоже разбираются', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    await guarded.invoke('{"query":"отпуск"}', toolExecuteConfig('call-3'));

    expect(calls).toEqual(['отпуск']);
  });

  it('пустая строка без обёртки считается непришедшими аргументами', async () => {
    const calls: string[] = [];
    const guarded = guardToolArguments(buildSearchTool(calls), ['query']);

    const result = await guarded.invoke('', toolExecuteConfig('call-4'));

    expect(calls).toEqual([]);
    expect(contentOf(result)).toContain('Повтори вызов');
  });

  it('у инструкции о сбое передачи выставлен tool_call_id из config.toolCall', async () => {
    const guarded = guardToolArguments(buildSearchTool([]), ['query']);

    const result = await guarded.invoke({}, toolExecuteConfig('call-5'));

    expect(typeof result).not.toBe('string');
    expect((result as ToolMessage).tool_call_id).toBe('call-5');
  });

  it('в форме ToolCall-обёртки у инструкции тоже выставлен tool_call_id', async () => {
    const guarded = guardToolArguments(buildSearchTool([]), ['query']);

    const result = await guarded.invoke(invocation({}));

    expect(typeof result).not.toBe('string');
    expect((result as ToolMessage).tool_call_id).toBe('call-1');
  });
});

describe('missingArgumentsMessage', () => {
  it('называет инструмент и потерянные параметры', () => {
    const message = missingArgumentsMessage('web_search', ['query']);

    expect(message).toContain('web_search');
    expect(message).toContain('query');
    expect(message).toContain('сбой передачи');
  });
});
