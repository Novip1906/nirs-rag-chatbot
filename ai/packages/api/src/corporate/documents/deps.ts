import mongoose from 'mongoose';
import { createProjectDocumentMethods, logger } from '@librechat/data-schemas';
import { generateShortLivedToken } from '~/crypto/jwt';
import { queryMultiple, querySingle } from '~/corporate/knowledge/rag';
import { knowledgeSearch, PROJECT_DOCUMENT_TUNING } from '~/corporate/knowledge/search';
import { buildProjectContext } from './context';
import type { KnowledgeSearchDeps, KnowledgeSearchHit } from '~/corporate/knowledge/search';
import type { ServerRequest } from '~/types/http';
import type { ProjectContextDeps } from './context';
import type { ProjectDocumentSummary } from './budget';

export interface ProjectDocumentRecord {
  file_id: string;
  title: string;
  tokenCount: number;
  text: string;
  entityId: string;
  embedded: boolean;
}

export interface ProjectContextSources {
  listProjectDocuments: (owner: string, projectId: string) => Promise<ProjectDocumentRecord[]>;
  lexicalSearch: KnowledgeSearchDeps['lexicalSearch'];
  denseSearch: KnowledgeSearchDeps['denseSearch'];
  denseSearchOne: KnowledgeSearchDeps['denseSearchOne'];
}

const PROJECT_SPACE_NAME = 'Документы проекта';

function toSummary(document: ProjectDocumentRecord): ProjectDocumentSummary {
  return {
    fileId: document.file_id,
    title: document.title,
    tokenCount: document.tokenCount,
    text: document.text,
    embedded: document.embedded,
  };
}

/**
 * `queryMultiple` и `querySingle` не проверяют `entity_id` сами, а rag_api при пустом
 * значении молча подставит id вызывающего пользователя: поиск ушёл бы в личное
 * пространство сотрудника и вернул ноль без единой ошибки. Поэтому пустой `projectId`
 * здесь — исключение, а не запрос по пустому разделу.
 */
export function projectEntityId(projectId: string): string {
  if (!projectId) {
    throw new Error(
      'projectId обязателен: без него rag_api подставит личное пространство вызывающего пользователя',
    );
  }
  return `proj_${projectId}`;
}

/**
 * Адаптер превращает документы проекта в форму, которую понимает гибридный поиск
 * `knowledgeSearch`: «пространство» — это единственный раздел проекта в rag_api
 * (`entity_id`), а «документы пространства» — ровно тот список, который вызывающая
 * сторона уже отобрала под поиск (`allocateDocuments` из задачи 4). Отдельной
 * проверки прав внутри адаптера нет и не должно быть: `listDocuments` уже отфильтровал
 * документы по `owner`, и в `denseSearch` уходят только их `fileId`.
 *
 * `entity_id` считается из `projectId`, который приходит аргументом каждого вызова:
 * порядок вызовов и переиспользование объекта зависимостей между запросами на
 * правильность раздела не влияют.
 */
export function buildProjectContextDeps(sources: ProjectContextSources): ProjectContextDeps {
  async function listDocuments(input: {
    owner: string;
    projectId: string;
  }): Promise<ProjectDocumentSummary[]> {
    const documents = await sources.listProjectDocuments(input.owner, input.projectId);
    return documents.map(toSummary);
  }

  async function search(input: {
    owner: string;
    projectId: string;
    documents: ProjectDocumentSummary[];
    query: string;
  }): Promise<KnowledgeSearchHit[]> {
    if (input.documents.length === 0) {
      return [];
    }
    const entityId = projectEntityId(input.projectId);

    const knowledgeDeps: KnowledgeSearchDeps = {
      resolveAllowedSpaces: async () => [
        { id: entityId, name: PROJECT_SPACE_NAME, allowedDepartments: [], enabled: true },
      ],
      findActiveDocuments: async () =>
        input.documents.map((document) => ({
          fileId: document.fileId,
          documentId: document.fileId,
          spaceId: entityId,
          spaceName: PROJECT_SPACE_NAME,
          title: document.title,
          description: '',
          filename: document.title,
          version: '',
          effectiveDate: null,
          owner: input.owner,
        })),
      lexicalSearch: sources.lexicalSearch,
      denseSearch: sources.denseSearch,
      denseSearchOne: sources.denseSearchOne,
    };

    return knowledgeSearch(knowledgeDeps, {
      userId: input.owner,
      query: input.query,
      tuning: PROJECT_DOCUMENT_TUNING,
    });
  }

  return { listDocuments, search };
}

/**
 * Привязка чата к проекту берётся из разговора, а для нового чата — из тела запроса:
 * разговора в Mongo ещё нет, `req.resolvedConversation` для него пуст, и без этого
 * запасного источника первое сообщение в проекте уходило бы к модели без документов.
 * Тело запроса подделать можно, но `listProjectDocuments` фильтрует по владельцу, а
 * поиск ограничен уже отфильтрованными `fileId`, поэтому чужие документы недостижимы.
 *
 * Сбой чтения документов не должен ронять ответ целиком: без документов чат ответит
 * хуже, но ответит — как и при недоступном rag_api внутри `buildProjectContext`.
 */
export async function buildProjectDocumentContext(req: ServerRequest): Promise<string | null> {
  const owner = req.user?.id;
  const projectId = req.resolvedConversation?.chatProjectId ?? req.body?.chatProjectId ?? null;
  if (!owner || !projectId) {
    return null;
  }

  const projectDocumentMethods = createProjectDocumentMethods(mongoose);
  const baseUrl = process.env.RAG_API_URL ?? '';
  const jwtToken = generateShortLivedToken(owner);

  const deps = buildProjectContextDeps({
    listProjectDocuments: projectDocumentMethods.listProjectDocuments,
    lexicalSearch: projectDocumentMethods.lexicalSearchProjectDocuments,
    denseSearch: (input) => queryMultiple({ baseUrl, token: jwtToken, ...input }),
    denseSearchOne: (input) => querySingle({ baseUrl, token: jwtToken, ...input }),
  });

  try {
    return await buildProjectContext(deps, {
      owner,
      projectId,
      query: req.body?.text ?? '',
    });
  } catch (error) {
    logger.warn('[documents] контекст документов проекта не собран:', error);
    return null;
  }
}
