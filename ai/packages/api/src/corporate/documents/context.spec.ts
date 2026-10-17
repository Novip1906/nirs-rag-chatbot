import { buildProjectContext, buildSearchQuery } from './context';
import type { ProjectContextDeps } from './context';
import type { ProjectDocumentSummary } from './budget';

function doc(
  fileId: string,
  tokenCount: number,
  title = fileId,
  embedded = true,
): ProjectDocumentSummary {
  return { fileId, title, tokenCount, text: `текст ${fileId} `.repeat(tokenCount), embedded };
}

const budgets = { inlineBudget: 1000, headTokens: 100, headBudget: 250, cardLimit: 30 };

function createDeps(overrides: Partial<ProjectContextDeps> = {}): ProjectContextDeps {
  return {
    listDocuments: async () => [],
    search: async () => [],
    ...overrides,
  };
}

describe('buildSearchQuery', () => {
  it('берёт текущее сообщение, когда оно содержательное', () => {
    expect(buildSearchQuery('какая ставка для маркетплейсов', 'предыдущее')).toBe(
      'какая ставка для маркетплейсов',
    );
  });

  /** «а подробнее?» само по себе не запрос: поиск по нему вернёт случайные куски. */
  it('добавляет предыдущее сообщение к слишком короткому', () => {
    expect(buildSearchQuery('а подробнее?', 'ставка эквайринга')).toBe(
      'а подробнее? ставка эквайринга',
    );
  });

  it('оставляет короткое сообщение как есть, если предыдущего нет', () => {
    expect(buildSearchQuery('а что?')).toBe('а что?');
  });
});

describe('buildProjectContext', () => {
  it('отдаёт null, когда чат не в проекте', async () => {
    const deps = createDeps({ listDocuments: async () => [doc('a', 10)] });

    expect(
      await buildProjectContext(deps, { owner: 'u1', projectId: null, query: 'что там' }),
    ).toBeNull();
  });

  it('отдаёт null, когда в проекте нет документов', async () => {
    expect(
      await buildProjectContext(createDeps(), { owner: 'u1', projectId: 'p1', query: 'что там' }),
    ).toBeNull();
  });

  it('кладёт карточку и полный текст, когда всё влезло', async () => {
    const deps = createDeps({ listDocuments: async () => [doc('a', 10, 'Регламент')] });

    const context = await buildProjectContext(deps, {
      owner: 'u1',
      projectId: 'p1',
      query: 'что там',
      budgets,
    });

    expect(context).toContain('Регламент');
    expect(context).toContain('текст a');
  });

  /**
   * Главная экономия: типовой проект из нескольких регламентов не платит за поиск
   * вообще, потому что искать в нём уже нечего — всё лежит в контексте.
   */
  it('не запускает поиск, когда все документы влезли целиком', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ listDocuments: async () => [doc('a', 10)], search });

    await buildProjectContext(deps, { owner: 'u1', projectId: 'p1', query: 'что там', budgets });

    expect(search).not.toHaveBeenCalled();
  });

  it('запускает поиск только по документам, не попавшим в контекст', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const deps = createDeps({
      listDocuments: async () => [doc('small', 10), doc('huge', 5000)],
      search,
    });

    await buildProjectContext(deps, { owner: 'u1', projectId: 'p1', query: 'что там', budgets });

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].documents.map((d: ProjectDocumentSummary) => d.fileId)).toEqual([
      'huge',
    ]);
    expect(search.mock.calls[0][0].projectId).toBe('p1');
  });

  it('добавляет найденные фрагменты с названием документа', async () => {
    const deps = createDeps({
      listDocuments: async () => [doc('huge', 5000, 'Договор')],
      search: async () => [
        {
          content: 'Ставка 2,9 процента',
          fileId: 'huge',
          page: 3,
          relevance: 0.7,
          document: {
            fileId: 'huge',
            documentId: 'huge',
            spaceId: 'p1',
            spaceName: 'Проект',
            title: 'Договор',
            description: '',
            filename: 'dogovor.docx',
            version: '',
            effectiveDate: null,
            owner: 'u1',
          },
        },
      ],
    });

    const context = await buildProjectContext(deps, {
      owner: 'u1',
      projectId: 'p1',
      query: 'ставка',
      budgets,
    });

    expect(context).toContain('Ставка 2,9 процента');
    expect(context).toContain('Договор');
  });

  /** Пустое сообщение (отправили одну картинку) искать нечем. */
  it('не ищет по пустому запросу', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ listDocuments: async () => [doc('huge', 5000)], search });

    const context = await buildProjectContext(deps, {
      owner: 'u1',
      projectId: 'p1',
      query: '   ',
      budgets,
    });

    expect(search).not.toHaveBeenCalled();
    expect(context).not.toBeNull();
  });

  it('переживает падение поиска и всё равно отдаёт карточку', async () => {
    const deps = createDeps({
      listDocuments: async () => [doc('huge', 5000, 'Договор')],
      search: async () => {
        throw new Error('rag_api недоступен');
      },
    });

    const context = await buildProjectContext(deps, {
      owner: 'u1',
      projectId: 'p1',
      query: 'ставка',
      budgets,
    });

    expect(context).toContain('Договор');
  });
});
