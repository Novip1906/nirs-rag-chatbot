import type { KnowledgeSpaceSource } from './access';
import type { KnowledgeDocumentSource } from './search';
import type { KnowledgeListDeps } from './list';
import { knowledgeList, LIST_DOCUMENT_CAP } from './list';

const spaces: KnowledgeSpaceSource[] = [
  { id: 'space-1', name: 'Пространство 1', allowedDepartments: [], enabled: true },
];

function makeDoc(i: number, spaceId: string, spaceName: string): KnowledgeDocumentSource {
  return {
    fileId: `doc-${spaceId}-${i}`,
    documentId: `id-${spaceId}-${i}`,
    spaceId,
    spaceName,
    title: `Документ ${i}`,
    description: '',
    filename: `${i}.pdf`,
    version: '1.0',
    effectiveDate: null,
    owner: '',
  };
}

function depsWithOneSpace(): KnowledgeListDeps {
  return {
    resolveAllowedSpaces: async () => spaces,
    findActiveDocuments: async () => [makeDoc(1, 'space-1', 'Пространство 1')],
  };
}

function depsWithDocs(count: number): KnowledgeListDeps {
  return {
    resolveAllowedSpaces: async () => spaces,
    findActiveDocuments: async () =>
      Array.from({ length: count }, (_, i) => makeDoc(i, 'space-1', 'Пространство 1')),
  };
}

function emptyDeps(): KnowledgeListDeps {
  return {
    resolveAllowedSpaces: async () => [],
    findActiveDocuments: async () => [],
  };
}

describe('knowledgeList', () => {
  it('не показывает документы из закрытого сотруднику пространства', async () => {
    const result = await knowledgeList(depsWithOneSpace(), 'u');
    expect(result.documents.map((d) => d.title)).not.toContain('Договор с банком');
  });

  it('до порога отдаёт документы, за порогом — сводку по пространствам', async () => {
    const few = await knowledgeList(depsWithDocs(10), 'u');
    expect(few.mode).toBe('documents');
    const many = await knowledgeList(depsWithDocs(LIST_DOCUMENT_CAP + 1), 'u');
    expect(many.mode).toBe('spaces');
    expect(many.documents).toEqual([]);
    expect(many.spaces[0].count).toBeGreaterThan(0);
  });

  it('пустая база — валидный результат, а не ошибка', async () => {
    const result = await knowledgeList(emptyDeps(), 'u');
    expect(result).toEqual({ mode: 'documents', documents: [], spaces: [] });
  });

  it('отдаёт модели описание документа: по названию «Приказ №12» выбрать невозможно', async () => {
    const deps = {
      resolveAllowedSpaces: jest.fn().mockResolvedValue([{ id: 's1', name: 'Продажи' }]),
      findActiveDocuments: jest.fn().mockResolvedValue([
        {
          fileId: 'f1',
          documentId: 'd1',
          spaceId: 's1',
          spaceName: 'Продажи',
          title: 'Приказ №12',
          filename: 'prikaz.pdf',
          version: '',
          effectiveDate: null,
          owner: '',
          description: 'Тарифы эквайринга для новых партнёров',
        },
      ]),
    } as unknown as KnowledgeListDeps;

    const result = await knowledgeList(deps, 'u1');

    expect(result.documents[0].description).toBe('Тарифы эквайринга для новых партнёров');
  });
});
