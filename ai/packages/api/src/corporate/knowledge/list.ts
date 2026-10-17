import type { KnowledgeSearchDeps, KnowledgeDocumentSource } from './search';

export const LIST_DOCUMENT_CAP = 200;

export interface KnowledgeListEntry {
  title: string;
  description: string;
  spaceName: string;
  version: string;
  effectiveDate: string | null;
}

export interface KnowledgeListResult {
  mode: 'documents' | 'spaces';
  documents: KnowledgeListEntry[];
  spaces: Array<{ name: string; count: number }>;
}

export type KnowledgeListDeps = Pick<
  KnowledgeSearchDeps,
  'resolveAllowedSpaces' | 'findActiveDocuments'
>;

function toEntry(document: KnowledgeDocumentSource): KnowledgeListEntry {
  return {
    title: document.title,
    description: document.description,
    spaceName: document.spaceName,
    version: document.version,
    effectiveDate: document.effectiveDate,
  };
}

/**
 * При числе документов больше `LIST_DOCUMENT_CAP` список режется до пространств
 * и числа документов в каждом, чтобы не съесть контекст модели — вместо
 * названий отдаётся сводка, а модель уточняет запрос через `knowledge_search`.
 */
export async function knowledgeList(
  deps: KnowledgeListDeps,
  userId: string,
): Promise<KnowledgeListResult> {
  const spaces = await deps.resolveAllowedSpaces(userId);
  if (spaces.length === 0) {
    return { mode: 'documents', documents: [], spaces: [] };
  }

  const documents = await deps.findActiveDocuments(spaces.map((space) => space.id));
  if (documents.length === 0) {
    return { mode: 'documents', documents: [], spaces: [] };
  }

  if (documents.length <= LIST_DOCUMENT_CAP) {
    return { mode: 'documents', documents: documents.map(toEntry), spaces: [] };
  }

  const countBySpace = new Map<string, number>();
  for (const document of documents) {
    countBySpace.set(document.spaceName, (countBySpace.get(document.spaceName) ?? 0) + 1);
  }

  return {
    mode: 'spaces',
    documents: [],
    spaces: [...countBySpace.entries()].map(([name, count]) => ({ name, count })),
  };
}
