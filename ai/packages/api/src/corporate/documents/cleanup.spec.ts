import { purgeProjectDocuments } from './cleanup';

function createDeps(overrides = {}) {
  return {
    listProjectDocumentsByProject: jest.fn().mockResolvedValue([
      { file_id: 'doc-1', entityId: 'proj_p1', storagePath: '/uploads/a.docx' },
      { file_id: 'doc-2', entityId: 'proj_p1', storagePath: '/uploads/b.docx' },
    ]),
    deleteVectors: jest.fn().mockResolvedValue(undefined),
    deleteProjectDocument: jest.fn().mockResolvedValue(null),
    removeOriginal: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('purgeProjectDocuments', () => {
  it('снимает векторы всех документов одним запросом', async () => {
    const deps = createDeps();

    await purgeProjectDocuments(deps, { owner: 'u1', projectId: 'p1' });

    expect(deps.deleteVectors).toHaveBeenCalledTimes(1);
    expect(deps.deleteVectors.mock.calls[0][0].fileIds).toEqual(['doc-1', 'doc-2']);
    expect(deps.deleteVectors.mock.calls[0][0].entityId).toBe('proj_p1');
  });

  /**
   * Если снять векторы не удалось, записи в Mongo обязаны остаться: иначе
   * `file_id` потерян и векторы останутся в pgvector навсегда.
   */
  it('не удаляет записи, если векторы снять не удалось', async () => {
    const deps = createDeps({
      deleteVectors: jest.fn().mockRejectedValue(new Error('rag_api недоступен')),
    });

    await expect(purgeProjectDocuments(deps, { owner: 'u1', projectId: 'p1' })).rejects.toThrow();
    expect(deps.deleteProjectDocument).not.toHaveBeenCalled();
  });

  it('убирает оригиналы с диска', async () => {
    const deps = createDeps();

    await purgeProjectDocuments(deps, { owner: 'u1', projectId: 'p1' });

    expect(deps.removeOriginal).toHaveBeenCalledTimes(2);
  });

  it('ничего не делает для проекта без документов', async () => {
    const deps = createDeps({ listProjectDocumentsByProject: jest.fn().mockResolvedValue([]) });

    expect(await purgeProjectDocuments(deps, { owner: 'u1', projectId: 'p1' })).toEqual({
      removed: 0,
    });
    expect(deps.deleteVectors).not.toHaveBeenCalled();
  });
});
