jest.mock('@librechat/api', () => ({
  /**
   * Защита от потерянных аргументов — чистая функция без зависимостей, и подменять её
   * нельзя: тест проверяет, что вызов с пустыми аргументами доходит до модели строкой,
   * а не валится валидацией схемы LangChain, — а это поведение и есть предмет проверки.
   */
  guardToolArguments: jest.requireActual('@librechat/api').guardToolArguments,
  resolvePolicy: jest.fn(),
  toResolvePolicyDeps: jest.fn(),
  resolveAllowedSpaces: jest.fn(),
  knowledgeSearch: jest.fn(),
  knowledgeList: jest.fn(),
  queryMultiple: jest.fn(),
  querySingle: jest.fn(),
  generateShortLivedToken: jest.fn(),
  /**
   * Нумерация якорей — чистая функция без зависимостей, поэтому здесь она
   * настоящая, а не заглушка: иначе тесты на стабильность номера документа
   * между вызовами проверяли бы саму заглушку. Собственное поведение этих
   * двух функций покрыто в packages/api/src/corporate/knowledge/citations.spec.ts.
   */
  knowledgeAnchor: (documentIndex) => `\\ue202turn0file${documentIndex}`,
  DocumentCitationIndex: class {
    constructor() {
      this.byFileId = new Map();
    }
    indexFor(fileId) {
      const existing = this.byFileId.get(fileId);
      if (existing != null) {
        return existing;
      }
      const next = this.byFileId.size;
      this.byFileId.set(fileId, next);
      return next;
    }
  },
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  listSpaces: jest.fn(),
  findActiveDocuments: jest.fn(),
  lexicalSearch: jest.fn(),
  getUserPolicy: jest.fn(),
  getGlobalSettings: jest.fn(),
  getDepartmentById: jest.fn(),
}));

const {
  createKnowledgeSearchTool,
  createKnowledgeListTool,
  toKnowledgeDocumentSource,
} = require('~/app/clients/tools/util/knowledge');

const hit = {
  content: 'Отпуск предоставляется на 28 календарных дней в году.',
  fileId: 'kb-1',
  page: null,
  relevance: 0.92,
  document: {
    fileId: 'kb-1',
    documentId: 'doc-1',
    spaceId: 'space-1',
    spaceName: 'Корпоративные стандарты',
    title: 'Положение об отпусках',
    filename: 'otpusk.pdf',
    version: '2.1',
    effectiveDate: '2026-03-14',
    owner: 'HR',
  },
};

describe('createKnowledgeSearchTool', () => {
  it('пустая база даёт модели явный текст, а не выдуманный ответ', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).toMatch(/нет доступных документов/i);
  });

  it('карточка фрагмента несёт название документа, якорь и содержание', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).toContain('turn0file0');
    expect(text).toContain('Положение об отпусках');
    expect(text).toContain(hit.content);
  });

  it('якорь документа не меняется между вызовами поиска в одном ответе', async () => {
    const other = { ...hit, fileId: 'kb-2', document: { ...hit.document, title: 'Приказ' } };
    let call = 0;
    const tool = await createKnowledgeSearchTool({
      userId: 'u',
      search: async () => (call++ === 0 ? [hit, other] : [other, hit]),
    });

    const [, first] = await tool.func({ query: 'отпуск' });
    const [, second] = await tool.func({ query: 'приказ' });

    const indexOf = (artifact, fileId) =>
      artifact.file_search.sources.find((source) => source.fileId === fileId).citationIndex;
    expect(indexOf(first, 'kb-1')).toBe(indexOf(second, 'kb-1'));
    expect(indexOf(first, 'kb-2')).toBe(indexOf(second, 'kb-2'));
  });

  it('разные документы получают разные номера', async () => {
    const other = { ...hit, fileId: 'kb-2', document: { ...hit.document, title: 'Приказ' } };
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit, other] });
    const [text, artifact] = await tool.func({ query: 'q' });

    expect(artifact.file_search.sources.map((source) => source.citationIndex)).toEqual([0, 1]);
    expect(text).toContain('turn0file0');
    expect(text).toContain('turn0file1');
  });

  it('несколько фрагментов одного документа несут один номер', async () => {
    const secondChunk = { ...hit, content: 'Второй фрагмент того же документа.' };
    const tool = await createKnowledgeSearchTool({
      userId: 'u',
      search: async () => [hit, secondChunk],
    });
    const [text, artifact] = await tool.func({ query: 'q' });

    expect(artifact.file_search.sources.map((source) => source.citationIndex)).toEqual([0, 0]);
    expect(text).not.toContain('turn0file1');
  });

  it('нумерация у каждого инструмента своя — ответы не наследуют чужие номера', async () => {
    const other = { ...hit, fileId: 'kb-9', document: { ...hit.document, title: 'Другой' } };
    const firstTool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    await firstTool.func({ query: 'q' });

    const secondTool = await createKnowledgeSearchTool({
      userId: 'u',
      search: async () => [other],
    });
    const [, artifact] = await secondTool.func({ query: 'q' });

    expect(artifact.file_search.sources[0].citationIndex).toBe(0);
  });

  it('карточка фрагмента не содержит версию, дату актуальности и пространство — модель их переписывает буквально, даже когда это не требуется', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).not.toContain('2.1');
    expect(text).not.toContain('2026-03-14');
    expect(text).not.toContain('Корпоративные стандарты');
    expect(text).not.toMatch(/версия|пространство|дата актуальности/i);
  });

  it('артефакт sources по-прежнему несёт версию, дату и пространство — для блока «Источники» на клиенте', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [, artifact] = await tool.func({ query: 'отпуск' });
    expect(artifact.file_search.sources[0]).toMatchObject({
      docTitle: 'Положение об отпусках',
      version: '2.1',
      effectiveDate: '2026-03-14',
      spaceName: 'Корпоративные стандарты',
    });
  });

  it('непустая выдача завершается указанием ответить по существу, а не отпиской о факте поиска', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).toMatch(/перескажи|ответь.*по существу/i);
    expect(text).toMatch(/факт|цифр/i);
  });

  it('указание ответить по существу больше не требует называть версию и дату — реквизиты переехали в блок источников', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).not.toMatch(/обязательно назови/i);
    expect(text).not.toMatch(/укажи[а-я]*\s+верси/i);
  });

  it('указание ответить по существу оставляет требование называть документ в тексте', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [hit] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).toMatch(/называя документ/i);
  });

  it('пустая выдача не содержит указания пересказать содержание — сообщение прежнее', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [] });
    const [text] = await tool.func({ query: 'отпуск' });
    expect(text).toBe(
      'По вашему запросу нет доступных документов в базе знаний. Проверьте формулировку или используйте knowledge_list, чтобы увидеть, какие документы вообще доступны.',
    );
  });

  it('пустая выдача всё равно отдаёт артефакт с пустым списком источников', async () => {
    const tool = await createKnowledgeSearchTool({ userId: 'u', search: async () => [] });
    const [, artifact] = await tool.func({ query: 'отпуск' });
    expect(artifact).toBeDefined();
    expect(artifact.file_search).toMatchObject({ sources: [], fileCitations: true });
  });

  it('запрос доходит до инжектированной функции search как есть', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const tool = await createKnowledgeSearchTool({ userId: 'u', search });
    await tool.func({ query: 'регламент командировок' });
    expect(search).toHaveBeenCalledWith('регламент командировок');
  });
});

describe('createKnowledgeListTool', () => {
  /**
   * Схема без единого свойства заставляет Gemini присылать `args: ""` вместо
   * `{}`. Пустая строка не разбирается как аргументы, вывод инструмента до
   * модели не доходит, и ход заканчивается без ответа сотруднику.
   */
  it('схема содержит хотя бы одно свойство', async () => {
    const tool = await createKnowledgeListTool({
      userId: 'u',
      list: async () => ({ mode: 'documents', documents: [], spaces: [] }),
    });
    const properties = tool.schema?.properties ?? tool.lc_kwargs?.schema?.properties;
    expect(Object.keys(properties ?? {}).length).toBeGreaterThan(0);
  });

  it('лишние аргументы не мешают выдать список', async () => {
    const tool = await createKnowledgeListTool({
      userId: 'u',
      list: async () => ({ mode: 'documents', documents: [], spaces: [] }),
    });
    const text = await tool.func({ reason: 'поиск ничего не нашёл' });
    expect(text).toMatch(/нет ни одного документа/i);
  });

  it('пустой список документов сообщается честно', async () => {
    const tool = await createKnowledgeListTool({
      userId: 'u',
      list: async () => ({ mode: 'documents', documents: [], spaces: [] }),
    });
    const text = await tool.func({});
    expect(text).toMatch(/нет ни одного документа/i);
  });

  it('в режиме documents перечисляет названия, пространство и версию', async () => {
    const tool = await createKnowledgeListTool({
      userId: 'u',
      list: async () => ({
        mode: 'documents',
        documents: [
          {
            title: 'Положение об отпусках',
            spaceName: 'Корпоративные стандарты',
            version: '2.1',
            effectiveDate: '2026-03-14',
          },
        ],
        spaces: [],
      }),
    });
    const text = await tool.func({});
    expect(text).toContain('Положение об отпусках');
    expect(text).toContain('Корпоративные стандарты');
    expect(text).toContain('2.1');
  });

  it('в режиме spaces (документов больше порога) отдаёт сводку и советует уточнить запрос', async () => {
    const tool = await createKnowledgeListTool({
      userId: 'u',
      list: async () => ({
        mode: 'spaces',
        documents: [],
        spaces: [{ name: 'Продуктовое', count: 250 }],
      }),
    });
    const text = await tool.func({});
    expect(text).toContain('Продуктовое');
    expect(text).toContain('250');
    expect(text).toMatch(/knowledge_search/);
  });
});

describe('toKnowledgeDocumentSource', () => {
  const doc = {
    _id: { toString: () => 'doc-1' },
    spaceId: { toString: () => 'space-1' },
    file_id: 'kb-1',
    title: 'Положение об отпусках',
    description: 'Порядок расчёта дней отпуска и подачи заявления',
    filename: 'otpusk.pdf',
    version: '2.1',
    effectiveDate: new Date('2026-03-14'),
    owner: 'HR',
    text: 'Полный текст документа, который не должен попасть в источники модели.',
    storagePath: '/app/uploads/knowledge/space-1/kb-1.pdf',
  };

  it('не пропускает text и storagePath — они внутренние и не должны утекать в контекст модели', () => {
    const source = toKnowledgeDocumentSource(doc, 'Корпоративные стандарты');
    expect(source).not.toHaveProperty('text');
    expect(source).not.toHaveProperty('storagePath');
  });

  it('переносит нужные поля, включая имя пространства', () => {
    const source = toKnowledgeDocumentSource(doc, 'Корпоративные стандарты');
    expect(source).toMatchObject({
      fileId: 'kb-1',
      documentId: 'doc-1',
      spaceId: 'space-1',
      spaceName: 'Корпоративные стандарты',
      title: 'Положение об отпусках',
      description: 'Порядок расчёта дней отпуска и подачи заявления',
      filename: 'otpusk.pdf',
      version: '2.1',
      owner: 'HR',
    });
    expect(source.effectiveDate).toBe(new Date('2026-03-14').toISOString());
  });

  it('effectiveDate = null остаётся null', () => {
    const source = toKnowledgeDocumentSource({ ...doc, effectiveDate: null }, 'Пространство');
    expect(source.effectiveDate).toBeNull();
  });
});

/**
 * На проде примерно каждый двенадцатый ответ приходил пустым: последний вызов
 * инструмента в ходе получал `args: ""`, валидация схемы LangChain падала раньше
 * обработчика, инструмент возвращал ноль символов, и модель заканчивала ход вообще
 * без текста. Проверяется настоящий инструмент целиком, вместе с его схемой.
 */
describe('потерянные аргументы вызова', () => {
  const call = (name, args) => ({ name, id: 'call-1', type: 'tool_call', args });
  const contentOf = (result) => (typeof result === 'string' ? result : result.content);

  const brokenArguments = [
    ['пустая строка', ''],
    ['пустой объект', {}],
    ['нет query', { reason: 'просто так' }],
    ['пустой query', { query: '   ' }],
    ['неразбираемая строка', '{"query":'],
  ];

  it.each(brokenArguments)(
    'knowledge_search с «%s» отвечает модели инструкцией, а не пустотой',
    async (_label, args) => {
      const search = jest.fn().mockResolvedValue([hit]);
      const tool = await createKnowledgeSearchTool({ userId: 'u', search });

      const content = contentOf(await tool.invoke(call('knowledge_search', args)));

      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('knowledge_search');
      expect(content).toContain('query');
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('knowledge_search с целым query работает как обычно', async () => {
    const search = jest.fn().mockResolvedValue([hit]);
    const tool = await createKnowledgeSearchTool({ userId: 'u', search });

    const result = await tool.invoke(call('knowledge_search', { query: 'отпуск' }));

    expect(search).toHaveBeenCalledWith('отпуск');
    expect(contentOf(result)).toContain('Положение об отпусках');
  });

  it('knowledge_search чинит аргументы, присланные строкой с JSON', async () => {
    const search = jest.fn().mockResolvedValue([hit]);
    const tool = await createKnowledgeSearchTool({ userId: 'u', search });

    await tool.invoke(call('knowledge_search', '{"query":"отпуск"}'));

    expect(search).toHaveBeenCalledWith('отпуск');
  });

  it('knowledge_list с пустой строкой вместо аргументов всё равно отдаёт список', async () => {
    const list = jest.fn().mockResolvedValue({ mode: 'documents', documents: [] });
    const tool = await createKnowledgeListTool({ userId: 'u', list });

    const content = contentOf(await tool.invoke(call('knowledge_list', '')));

    expect(list).toHaveBeenCalledTimes(1);
    expect(content).toContain('нет ни одного документа');
  });
});
