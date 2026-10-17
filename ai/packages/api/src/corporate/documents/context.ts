import { logger } from '@librechat/data-schemas';
import type { KnowledgeSearchHit } from '~/corporate/knowledge/search';
import type { ContextBudgets, DocumentHead, ProjectDocumentSummary } from './budget';
import { allocateDocuments, buildDocumentCard, PROJECT_CONTEXT_BUDGETS } from './budget';

export const SHORT_QUERY_LENGTH = 15;

export interface ProjectContextDeps {
  listDocuments: (input: { owner: string; projectId: string }) => Promise<ProjectDocumentSummary[]>;
  search: (input: {
    owner: string;
    projectId: string;
    documents: ProjectDocumentSummary[];
    query: string;
  }) => Promise<KnowledgeSearchHit[]>;
}

export interface ProjectContextInput {
  owner: string;
  projectId: string | null;
  query: string;
  previousQuery?: string;
  budgets?: ContextBudgets;
}

/**
 * «а подробнее?» само по себе не запрос — поиск по нему вернёт случайные куски.
 * Предыдущая реплика сотрудника возвращает такому уточнению тему.
 */
export function buildSearchQuery(query: string, previousQuery?: string): string {
  const trimmed = query.trim();
  if (trimmed.length >= SHORT_QUERY_LENGTH || !previousQuery) {
    return trimmed;
  }
  return `${trimmed} ${previousQuery.trim()}`.trim();
}

function renderInline(documents: ProjectDocumentSummary[]): string {
  return documents.map((document) => `## ${document.title}\n${document.text}`).join('\n\n');
}

function renderHeads(heads: DocumentHead[]): string {
  return heads
    .map((head) => `## ${head.document.title} (начало документа)\n${head.text}`)
    .join('\n\n');
}

function renderHits(hits: KnowledgeSearchHit[]): string {
  return hits.map((hit) => `## ${hit.document.title} (фрагмент)\n${hit.content}`).join('\n\n');
}

/**
 * Падение поиска не должно ронять ответ: карточка и то, что уже лежит в контексте,
 * полезнее пустого ответа, а `rag_api` может быть временно недоступен.
 */
async function searchQuietly(
  deps: ProjectContextDeps,
  input: { owner: string; projectId: string; documents: ProjectDocumentSummary[]; query: string },
): Promise<KnowledgeSearchHit[]> {
  try {
    return await deps.search(input);
  } catch (error) {
    logger.warn('[documents] поиск по документам проекта не удался:', error);
    return [];
  }
}

export async function buildProjectContext(
  deps: ProjectContextDeps,
  input: ProjectContextInput,
): Promise<string | null> {
  if (input.projectId == null || input.projectId === '') {
    return null;
  }

  const documents = await deps.listDocuments({ owner: input.owner, projectId: input.projectId });
  if (documents.length === 0) {
    return null;
  }

  const budgets = input.budgets ?? PROJECT_CONTEXT_BUDGETS;
  const allocation = allocateDocuments(documents, budgets);
  const query = buildSearchQuery(input.query, input.previousQuery);

  const hits =
    allocation.searchable.length > 0 && query !== ''
      ? await searchQuietly(deps, {
          owner: input.owner,
          projectId: input.projectId,
          documents: allocation.searchable,
          query,
        })
      : [];

  const sections = [
    buildDocumentCard(documents, allocation, budgets.cardLimit),
    renderInline(allocation.inline),
    renderHeads(allocation.heads),
    renderHits(hits),
  ].filter((section) => section !== '');

  return sections.join('\n\n');
}
