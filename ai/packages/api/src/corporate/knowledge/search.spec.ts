import type { KnowledgeSpaceSource } from './access';
import type { RagChunk } from './rag';
import type { KnowledgeSearchDeps, KnowledgeDocumentSource } from './search';
import {
  knowledgeSearch,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_HITS,
  MIN_CHUNK_LENGTH,
  RELEVANCE_FLOOR,
  RELEVANCE_RATIO,
  KNOWLEDGE_TUNING,
  PROJECT_DOCUMENT_TUNING,
} from './search';

/**
 * Поиск отбрасывает фрагменты короче `MIN_CHUNK_LENGTH`, поэтому содержимое в
 * фикстурах должно быть правдоподобной длины — иначе тест проверял бы отсев по
 * длине вместо того, что в нём написано.
 */
function body(label: string): string {
  return `${label} ${'текст '.repeat(60)}`;
}

const spaces: KnowledgeSpaceSource[] = [
  { id: 'space-1', name: 'Пространство 1', allowedDepartments: [], enabled: true },
  { id: 'space-2', name: 'Пространство 2', allowedDepartments: [], enabled: true },
];

const docA: KnowledgeDocumentSource = {
  fileId: 'doc-a',
  documentId: 'id-a',
  spaceId: 'space-1',
  spaceName: 'Пространство 1',
  title: 'Документ А',
  description: '',
  filename: 'a.pdf',
  version: '1.0',
  effectiveDate: null,
  owner: 'Иванов',
};

const docB: KnowledgeDocumentSource = {
  fileId: 'doc-b',
  documentId: 'id-b',
  spaceId: 'space-2',
  spaceName: 'Пространство 2',
  title: 'Документ Б',
  description: '',
  filename: 'b.pdf',
  version: '2.0',
  effectiveDate: '2026-01-01',
  owner: 'Петров',
};

const docPrikaz: KnowledgeDocumentSource = {
  fileId: 'prikaz',
  documentId: 'id-p',
  spaceId: 'space-1',
  spaceName: 'Пространство 1',
  title: 'Приказ № 47-П',
  description: '',
  filename: 'prikaz.pdf',
  version: '',
  effectiveDate: null,
  owner: '',
};

function makeDeps(overrides: Partial<KnowledgeSearchDeps> = {}): KnowledgeSearchDeps {
  return {
    resolveAllowedSpaces: async () => spaces,
    findActiveDocuments: async () => [docA, docB, docPrikaz],
    lexicalSearch: async () => [],
    denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
      fileIds.map((fileId, i) => ({
        fileId,
        content: body(`dense ${fileId}`),
        distance: 0.1 + i * 0.05,
        page: null,
      })),
    ),
    denseSearchOne: jest.fn(async ({ fileId }: { fileId: string }): Promise<RagChunk[]> => [
      { fileId, content: body(`single ${fileId}`), distance: 0.3, page: null },
    ]),
    ...overrides,
  };
}

describe('knowledgeSearch: отсечка по релевантности', () => {
  /** Значения взяты из реальных запросов прода, см. комментарий в search.ts. */
  function depsWithDistances(byFile: Record<string, number[]>): KnowledgeSearchDeps {
    return makeDeps({
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId) =>
          (byFile[fileId] ?? []).map((relevance) => ({
            fileId,
            content: body(`chunk ${fileId}`),
            distance: 1 - relevance,
            page: null,
          })),
        ),
      ),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });
  }

  it('оставляет оторвавшийся кластер и отбрасывает хвост', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.5178, 0.5021], 'doc-b': [0.3813, 0.264] });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'план поездки Япония' });
    expect(hits.map((hit) => hit.fileId)).toEqual(['doc-a', 'doc-a']);
  });

  it('порог считается от лучшего совпадения, а не от абсолютной величины', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.4684, 0.4596], 'doc-b': [0.3996] });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'когда ехать в Японию' });
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.fileId === 'doc-a')).toBe(true);
  });

  it('когда подходящего нет и всё слиплось, кластер не разрывается искусственно', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.4628], 'doc-b': [0.4608, 0.4395] });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'евротрак симулятор бэкапы' });
    expect(hits.length).toBeGreaterThan(1);
  });

  it('заведомо слабую выдачу отбрасывает целиком', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.31, 0.28], 'doc-b': [0.24] });
    expect(await knowledgeSearch(deps, { userId: 'u', query: 'q' })).toEqual([]);
  });

  it('мусорную полосу ниже пола отбрасывает целиком, даже если она плотная', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.411, 0.408], 'doc-b': [0.405, 0.397] });
    expect(await knowledgeSearch(deps, { userId: 'u', query: 'как приготовить борщ' })).toEqual([]);
  });

  it('самое слабое верное попадание проходит', async () => {
    const deps = depsWithDistances({ 'doc-a': [0.471] });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'базовая ставка эквайринга' });
    expect(hits).toHaveLength(1);
  });

  it('пол и отношение согласованы между собой', () => {
    expect(RELEVANCE_FLOOR).toBeGreaterThan(0);
    expect(RELEVANCE_RATIO).toBeGreaterThan(0);
    expect(RELEVANCE_RATIO).toBeLessThanOrEqual(1);
  });
});

describe('knowledgeSearch', () => {
  it('без доступных пространств возвращает пусто и не ходит в rag_api', async () => {
    const deps = makeDeps({ resolveAllowedSpaces: async () => [] });
    expect(await knowledgeSearch(deps, { userId: 'u', query: 'q' })).toEqual([]);
    expect(deps.denseSearch).not.toHaveBeenCalled();
  });

  it('без активных документов возвращает пусто', async () => {
    const deps = makeDeps({ findActiveDocuments: async () => [] });
    expect(await knowledgeSearch(deps, { userId: 'u', query: 'q' })).toEqual([]);
    expect(deps.denseSearch).not.toHaveBeenCalled();
  });

  it('в каждое пространство уходит его собственный entityId', async () => {
    const deps = makeDeps();
    await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(deps.denseSearch).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'space-1' }));
    expect(deps.denseSearch).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'space-2' }));
  });

  it('в поиск не попадают file_id вне разрешённых пространств', async () => {
    const deps = makeDeps();
    await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    const denseSearchMock = deps.denseSearch as jest.Mock;
    const passed = denseSearchMock.mock.calls.flatMap(
      (call: [{ fileIds: string[] }]) => call[0].fileIds,
    );
    expect(passed).not.toContain('чужой-файл');
  });

  it('документ, поднятый только лексикой, добирает чанки точечным запросом', async () => {
    const deps = makeDeps({
      denseSearch: jest.fn().mockResolvedValue([]),
      lexicalSearch: jest.fn().mockResolvedValue(['prikaz']),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: '47-П' });
    expect(deps.denseSearchOne).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'prikaz' }));
    expect(hits[0].document.title).toBe('Приказ № 47-П');
  });

  it('каждый фрагмент несёт метаданные своего документа', async () => {
    const hits = await knowledgeSearch(makeDeps(), { userId: 'u', query: 'q' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].document).toMatchObject({
      title: expect.any(String),
      version: expect.any(String),
    });
  });

  it('выдача не длиннее MAX_HITS', async () => {
    const manyDocs: KnowledgeDocumentSource[] = Array.from({ length: 15 }, (_, i) => ({
      fileId: `doc-${i}`,
      documentId: `id-${i}`,
      spaceId: 'space-1',
      spaceName: 'Пространство 1',
      title: `Документ ${i}`,
      description: '',
      filename: `${i}.pdf`,
      version: '1.0',
      effectiveDate: null,
      owner: '',
    }));
    const deps = makeDeps({
      findActiveDocuments: async () => manyDocs,
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId, i) => [
          { fileId, content: body('c1'), distance: 0.1 + i * 0.01, page: null },
          { fileId, content: body('c2'), distance: 0.2 + i * 0.01, page: null },
        ]),
      ),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(hits.length).toBe(MAX_HITS);
  });

  it('фрагменты короче MIN_CHUNK_LENGTH в выдачу не попадают', async () => {
    const deps = makeDeps({
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId) => [
          { fileId, content: '*Ресурсы', distance: 0.2, page: null },
          { fileId, content: body('содержательный фрагмент'), distance: 0.25, page: null },
        ]),
      ),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.content.trim().length >= MIN_CHUNK_LENGTH)).toBe(true);
  });

  it('документ, у которого все фрагменты короткие, выпадает из выдачи целиком', async () => {
    const deps = makeDeps({
      findActiveDocuments: async () => [docA, docB],
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId) =>
          fileId === 'doc-a'
            ? [{ fileId, content: 'Kласс*', distance: 0.2, page: null }]
            : [{ fileId, content: body('целый абзац'), distance: 0.25, page: null }],
        ),
      ),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(hits.map((hit) => hit.fileId)).toEqual(['doc-b']);
  });

  it('один документ не занимает больше MAX_CHUNKS_PER_DOCUMENT мест', async () => {
    const deps = makeDeps({
      findActiveDocuments: async () => [docA],
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId) =>
          Array.from({ length: 6 }, (_, i) => ({
            fileId,
            content: body(`страница ${i}`),
            distance: 0.2 + i * 0.001,
            page: i,
          })),
        ),
      ),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'маршрутная квитанция' });
    expect(hits).toHaveLength(MAX_CHUNKS_PER_DOCUMENT);
    expect(hits.map((hit) => hit.page)).toEqual([0, 1, 2]);
  });

  it('с документа берутся самые близкие фрагменты, а не первые попавшиеся', async () => {
    const deps = makeDeps({
      findActiveDocuments: async () => [docA],
      denseSearch: jest.fn(async ({ fileIds }: { fileIds: string[] }): Promise<RagChunk[]> =>
        fileIds.flatMap((fileId) => [
          { fileId, content: body('далёкий'), distance: 0.16, page: 9 },
          { fileId, content: body('близкий'), distance: 0.1, page: 1 },
          { fileId, content: body('средний'), distance: 0.14, page: 5 },
          { fileId, content: body('дальше всех'), distance: 0.18, page: 12 },
        ]),
      ),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(hits.map((hit) => hit.page)).toEqual([1, 5, 9]);
  });

  it('падение плотной ветки не роняет лексическую', async () => {
    const deps = makeDeps({
      denseSearch: jest.fn().mockResolvedValue([]),
      lexicalSearch: jest.fn().mockResolvedValue(['prikaz']),
    });
    const hits = await knowledgeSearch(deps, { userId: 'u', query: 'q' });
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('knowledgeSearch с настройкой порогов', () => {
  const projectSpace: KnowledgeSpaceSource = {
    id: 'proj_1',
    name: 'Проект',
    allowedDepartments: [],
    enabled: true,
  };

  const projectDoc: KnowledgeDocumentSource = {
    fileId: 'doc-1',
    documentId: 'id-1',
    spaceId: 'proj_1',
    spaceName: 'Проект',
    title: 'Документ проекта',
    description: '',
    filename: 'doc.pdf',
    version: '',
    effectiveDate: null,
    owner: '',
  };

  /**
   * Для документа, приложенного самим сотрудником, пропуск хуже лишнего фрагмента:
   * он этот документ видел и ждёт, что по нему ответят. Абсолютный пол снимается.
   */
  it('без порогов отдаёт слабые совпадения, которые база знаний отсекла бы', async () => {
    const deps = makeDeps({
      resolveAllowedSpaces: async () => [projectSpace],
      findActiveDocuments: async () => [projectDoc],
      denseSearch: jest
        .fn()
        .mockResolvedValue([
          { fileId: 'doc-1', content: body('слабое совпадение'), distance: 0.8, page: null },
        ]),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });

    const withFloor = await knowledgeSearch(deps, { userId: 'u1', query: 'что там' });
    const withoutFloor = await knowledgeSearch(deps, {
      userId: 'u1',
      query: 'что там',
      tuning: PROJECT_DOCUMENT_TUNING,
    });

    expect(withFloor).toHaveLength(0);
    expect(withoutFloor).toHaveLength(1);
  });

  /** Короткие фрагменты в проекте нужны: таблицы и слайды режутся в мелкие куски. */
  it('пропускает короткие фрагменты при пониженном минимуме', async () => {
    const shortChunk = { fileId: 'doc-1', content: 'x'.repeat(150), distance: 0.1, page: null };
    const deps = makeDeps({
      resolveAllowedSpaces: async () => [projectSpace],
      findActiveDocuments: async () => [projectDoc],
      denseSearch: jest.fn().mockResolvedValue([shortChunk]),
      denseSearchOne: jest.fn().mockResolvedValue([]),
    });

    expect(await knowledgeSearch(deps, { userId: 'u1', query: 'таблица' })).toHaveLength(0);
    expect(
      await knowledgeSearch(deps, {
        userId: 'u1',
        query: 'таблица',
        tuning: PROJECT_DOCUMENT_TUNING,
      }),
    ).toHaveLength(1);
  });

  it('без аргумента ведёт себя ровно как раньше', async () => {
    const deps = makeDeps();

    const implicit = await knowledgeSearch(deps, { userId: 'u1', query: 'регламент' });
    const explicit = await knowledgeSearch(deps, {
      userId: 'u1',
      query: 'регламент',
      tuning: KNOWLEDGE_TUNING,
    });

    expect(implicit).toEqual(explicit);
  });
});
