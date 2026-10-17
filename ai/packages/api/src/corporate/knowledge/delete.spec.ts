import { KnowledgeSpaceNotEmptyError } from '@librechat/data-schemas';
import {
  deleteDocumentPermanently,
  deleteSpaceConflictCount,
  isDeleteSpaceConflict,
} from './delete';
import type { IKnowledgeDocument } from '@librechat/data-schemas';

function mockDocument(
  overrides: Partial<Pick<IKnowledgeDocument, '_id' | 'file_id' | 'spaceId' | 'storagePath'>> = {},
) {
  return {
    _id: { toString: () => 'doc-1' },
    file_id: 'f1',
    spaceId: { toString: () => 'space-1' },
    storagePath: '/app/uploads/f1.pdf',
    ...overrides,
  } as Pick<IKnowledgeDocument, '_id' | 'file_id' | 'spaceId' | 'storagePath'>;
}

describe('deleteDocumentPermanently', () => {
  it('снимает векторы раньше записи в MongoDB и удаляет оригинал', async () => {
    const order: string[] = [];
    const deps = {
      deleteVectors: jest.fn(async () => {
        order.push('vectors');
      }),
      deleteDocument: jest.fn(async () => {
        order.push('mongo');
        return true;
      }),
      removeOriginal: jest.fn(async () => {
        order.push('original');
      }),
    };

    const outcome = await deleteDocumentPermanently(deps, mockDocument(), 'u1');

    expect(outcome).toEqual({ ok: true });
    expect(order).toEqual(['vectors', 'mongo', 'original']);
    expect(deps.deleteVectors).toHaveBeenCalledWith({
      fileIds: ['f1'],
      entityId: 'space-1',
      userId: 'u1',
    });
    expect(deps.deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(deps.removeOriginal).toHaveBeenCalledWith('/app/uploads/f1.pdf');
  });

  it('не удаляет запись и оригинал, если снять векторы не удалось', async () => {
    const deps = {
      deleteVectors: jest.fn().mockRejectedValue(new Error('rag down')),
      deleteDocument: jest.fn(),
      removeOriginal: jest.fn(),
    };

    const outcome = await deleteDocumentPermanently(deps, mockDocument(), 'u1');

    expect(outcome).toEqual({ ok: false, error: 'vectors' });
    expect(deps.deleteDocument).not.toHaveBeenCalled();
    expect(deps.removeOriginal).not.toHaveBeenCalled();
  });

  it('не зовёт removeOriginal, если у документа нет сохранённого оригинала', async () => {
    const deps = {
      deleteVectors: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(true),
      removeOriginal: jest.fn(),
    };

    await deleteDocumentPermanently(deps, mockDocument({ storagePath: '' }), 'u1');

    expect(deps.removeOriginal).not.toHaveBeenCalled();
  });
});

describe('isDeleteSpaceConflict / deleteSpaceConflictCount', () => {
  it('распознаёт конфликт удаления пространства и читает число документов', () => {
    const error = new KnowledgeSpaceNotEmptyError(5);
    expect(isDeleteSpaceConflict(error)).toBe(true);
    expect(deleteSpaceConflictCount(error)).toBe(5);
  });

  it('не считает конфликтом постороннюю ошибку', () => {
    const error = new Error('connection refused');
    expect(isDeleteSpaceConflict(error)).toBe(false);
    expect(deleteSpaceConflictCount(error)).toBeUndefined();
  });

  /** Раньше конфликт узнавали по слову «документ» в сообщении — на этой ошибке
   *  такая проверка ошиблась бы. */
  it('не считает конфликтом чужую ошибку со словом «документ» в тексте', () => {
    const error = new Error('Не удалось прочитать документ');
    expect(isDeleteSpaceConflict(error)).toBe(false);
    expect(deleteSpaceConflictCount(error)).toBeUndefined();
  });
});
