import { buildProjectContextDeps, projectEntityId } from './deps';

const owner = 'user-1';
const projectId = 'project-1';

function projectDocument(fileId: string) {
  return {
    file_id: fileId,
    title: `Документ ${fileId}`,
    tokenCount: 100,
    text: 'тело документа',
    entityId: `proj_${projectId}`,
    embedded: true,
  };
}

describe('buildProjectContextDeps', () => {
  it('превращает документы проекта в форму, понятную поиску', async () => {
    const deps = buildProjectContextDeps({
      listProjectDocuments: async () => [projectDocument('doc-1')],
      lexicalSearch: async () => [],
      denseSearch: async () => [],
      denseSearchOne: async () => [],
    });

    const documents = await deps.listDocuments({ owner, projectId });

    expect(documents).toEqual([
      { fileId: 'doc-1', title: 'Документ doc-1', tokenCount: 100, text: 'тело документа' },
    ]);
  });

  /**
   * Раздел в rag_api у всех документов проекта один, поэтому плотная ветка
   * должна сходить ровно один раз, а не по разу на документ.
   */
  it('ищет по разделу проекта одним запросом', async () => {
    const denseSearch = jest.fn().mockResolvedValue([]);
    const deps = buildProjectContextDeps({
      listProjectDocuments: async () => [projectDocument('doc-1'), projectDocument('doc-2')],
      lexicalSearch: async () => [],
      denseSearch,
      denseSearchOne: async () => [],
    });

    await deps.search({
      owner,
      projectId,
      documents: [
        { fileId: 'doc-1', title: 'a', tokenCount: 10, text: 'a', embedded: true },
        { fileId: 'doc-2', title: 'b', tokenCount: 10, text: 'b', embedded: true },
      ],
      query: 'ставка',
    });

    expect(denseSearch).toHaveBeenCalledTimes(1);
    expect(denseSearch.mock.calls[0][0].fileIds).toEqual(['doc-1', 'doc-2']);
    expect(denseSearch.mock.calls[0][0].entityId).toBe('proj_project-1');
  });

  /**
   * Пустой `entity_id` rag_api подменяет на личное пространство вызывающего: поиск
   * ушёл бы не туда и вернул ноль без единой ошибки. Отказ должен быть громким.
   */
  it('отказывается искать без проекта, а не ищет в личном пространстве', async () => {
    const denseSearch = jest.fn().mockResolvedValue([]);
    const deps = buildProjectContextDeps({
      listProjectDocuments: async () => [projectDocument('doc-1')],
      lexicalSearch: async () => [],
      denseSearch,
      denseSearchOne: async () => [],
    });

    await expect(
      deps.search({
        owner,
        projectId: '',
        documents: [{ fileId: 'doc-1', title: 'a', tokenCount: 10, text: 'a', embedded: true }],
        query: 'ставка',
      }),
    ).rejects.toThrow('projectId обязателен');
    expect(denseSearch).not.toHaveBeenCalled();
  });

  it('строит раздел rag_api из идентификатора проекта', () => {
    expect(projectEntityId('project-1')).toBe('proj_project-1');
    expect(() => projectEntityId('')).toThrow('projectId обязателен');
  });

  it('не ищет, когда искать не по чему', async () => {
    const denseSearch = jest.fn().mockResolvedValue([]);
    const deps = buildProjectContextDeps({
      listProjectDocuments: async () => [],
      lexicalSearch: async () => [],
      denseSearch,
      denseSearchOne: async () => [],
    });

    expect(await deps.search({ owner, projectId, documents: [], query: 'ставка' })).toEqual([]);
    expect(denseSearch).not.toHaveBeenCalled();
  });
});
