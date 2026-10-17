import { logger } from '@librechat/data-schemas';
import type { KnowledgeSpaceSource } from './access';
import type { RagChunk } from './rag';
import { reciprocalRankFusion } from './fusion';

export interface KnowledgeDocumentSource {
  fileId: string;
  documentId: string;
  spaceId: string;
  spaceName: string;
  title: string;
  description: string;
  filename: string;
  version: string;
  effectiveDate: string | null;
  owner: string;
}

export interface KnowledgeSearchHit {
  content: string;
  fileId: string;
  page: number | null;
  relevance: number;
  document: KnowledgeDocumentSource;
}

export interface KnowledgeSearchDeps {
  resolveAllowedSpaces: (userId: string) => Promise<KnowledgeSpaceSource[]>;
  findActiveDocuments: (spaceIds: string[]) => Promise<KnowledgeDocumentSource[]>;
  lexicalSearch: (input: { fileIds: string[]; query: string; limit: number }) => Promise<string[]>;
  denseSearch: (input: {
    query: string;
    fileIds: string[];
    entityId: string;
    k: number;
  }) => Promise<RagChunk[]>;
  denseSearchOne: (input: {
    query: string;
    fileId: string;
    entityId: string;
    k: number;
  }) => Promise<RagChunk[]>;
}

export const DENSE_K_PER_SPACE = 5;
export const LEXICAL_LIMIT = 20;
export const MAX_HITS = 10;

/**
 * Отсечка двухступенчатая: абсолютный пол плюс относительный разрыв.
 *
 * Пол в 0.45 подтверждён замером на стенде (15 запросов, 10 с ответом в базе).
 * Ниже него оказывается только мусор: на «как приготовить борщ» лучшее
 * совпадение 0.411, на голом «Япония» — 0.403. Самое слабое верное попадание,
 * «какая базовая ставка эквайринга», даёт 0.471 — запас есть, но небольшой,
 * поэтому пол не поднимаем выше.
 *
 * Относительный разрыв нужен потому, что близость к порогу сама по себе ничего
 * не значит: когда подходящий документ есть, его фрагменты отрываются от
 * остальных, когда нет — всё слипается в узкую полосу.
 */
export const RELEVANCE_FLOOR = 0.45;
export const RELEVANCE_RATIO = 0.9;

/**
 * Фрагменты короче этого в выдачу не идут. Слайдовые PDF извлекаются в подписи
 * вроде «HTTP», «Циклы*», «Kласс*» по 4-13 знаков: такая строка ни на что не
 * похожа конкретно, но и ни от чего конкретно не отличается, поэтому всплывает
 * на любой запрос, к которому в базе нет настоящего ответа. На стенде две такие
 * презентации давали 115 фрагментов из 146 во всём индексе.
 *
 * Порог безопасен для настоящих документов: самый короткий регламент из
 * загруженных занимает 385 знаков и режется в один фрагмент целиком.
 */
export const MIN_CHUNK_LENGTH = 300;

/**
 * Больше этого числа фрагментов с одного документа в выдачу не попадает.
 * Фрагменты складываются пачками по документам, поэтому один многостраничный
 * документ иначе съедает весь бюджет `MAX_HITS`: наблюдалось на стенде — четыре
 * страницы одной маршрутной квитанции по 1400 знаков в одном ответе.
 *
 * Схлопывать их по похожести нельзя: страницы совпадают на 92%, но это разные
 * пассажиры с разными номерами билетов. Ограничиваем количество, не склеиваем.
 */
export const MAX_CHUNKS_PER_DOCUMENT = 3;

export interface SearchTuning {
  relevanceFloor: number;
  relevanceRatio: number;
  minChunkLength: number;
}

export const KNOWLEDGE_TUNING: SearchTuning = {
  relevanceFloor: RELEVANCE_FLOOR,
  relevanceRatio: RELEVANCE_RATIO,
  minChunkLength: MIN_CHUNK_LENGTH,
};

/**
 * Документы проекта сотрудник приложил сам, поэтому отсечки сняты: пропустить
 * то, что он ждёт увидеть, хуже, чем показать модели лишний фрагмент. Минимальная
 * длина снижена ради таблиц и слайдов, которые режутся в короткие куски.
 */
export const PROJECT_DOCUMENT_TUNING: SearchTuning = {
  relevanceFloor: 0,
  relevanceRatio: 0,
  minChunkLength: 100,
};

function keepRelevant(hits: KnowledgeSearchHit[], tuning: SearchTuning): KnowledgeSearchHit[] {
  if (hits.length === 0) {
    return hits;
  }
  let best = 0;
  for (const hit of hits) {
    if (hit.relevance > best) {
      best = hit.relevance;
    }
  }
  const cutoff = Math.max(tuning.relevanceFloor, best * tuning.relevanceRatio);
  return hits.filter((hit) => hit.relevance >= cutoff);
}

function dedupeByFileIdOrderedByDistance(chunks: RagChunk[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const chunk of [...chunks].sort((a, b) => a.distance - b.distance)) {
    if (seen.has(chunk.fileId)) {
      continue;
    }
    seen.add(chunk.fileId);
    ordered.push(chunk.fileId);
  }
  return ordered;
}

function toHit(chunk: RagChunk, document: KnowledgeDocumentSource): KnowledgeSearchHit {
  return {
    content: chunk.content,
    fileId: chunk.fileId,
    page: chunk.page,
    relevance: 1 - chunk.distance,
    document,
  };
}

/**
 * Гибридный поиск: плотная ветка запрашивается по одному разу на
 * пространство (а не на документ — это ограничивает число HTTP-запросов
 * числом пространств), лексическая — одним запросом Mongo по всем
 * разрешённым file_id. Слияние — RRF на уровне документа; документы,
 * поднятые только лексикой, добирают фрагменты точечным `denseSearchOne`.
 */
export async function knowledgeSearch(
  deps: KnowledgeSearchDeps,
  input: { userId: string; query: string; tuning?: SearchTuning },
): Promise<KnowledgeSearchHit[]> {
  const tuning = input.tuning ?? KNOWLEDGE_TUNING;
  const spaces = await deps.resolveAllowedSpaces(input.userId);
  if (spaces.length === 0) {
    return [];
  }

  const documents = await deps.findActiveDocuments(spaces.map((space) => space.id));
  if (documents.length === 0) {
    return [];
  }

  const documentsBySpace = new Map<string, KnowledgeDocumentSource[]>();
  const documentByFileId = new Map<string, KnowledgeDocumentSource>();
  for (const document of documents) {
    const spaceDocs = documentsBySpace.get(document.spaceId) ?? [];
    spaceDocs.push(document);
    documentsBySpace.set(document.spaceId, spaceDocs);
    documentByFileId.set(document.fileId, document);
  }

  const allFileIds = documents.map((document) => document.fileId);

  const [denseResults, lexicalRanking] = await Promise.all([
    Promise.all(
      spaces
        .filter((space) => (documentsBySpace.get(space.id)?.length ?? 0) > 0)
        .map((space) =>
          deps.denseSearch({
            query: input.query,
            fileIds: (documentsBySpace.get(space.id) ?? []).map((document) => document.fileId),
            entityId: space.id,
            k: DENSE_K_PER_SPACE,
          }),
        ),
    ),
    deps.lexicalSearch({ fileIds: allFileIds, query: input.query, limit: LEXICAL_LIMIT }),
  ]);

  const denseChunks = denseResults.flat();
  const chunksByFileId = new Map<string, RagChunk[]>();
  for (const chunk of denseChunks) {
    const existing = chunksByFileId.get(chunk.fileId) ?? [];
    existing.push(chunk);
    chunksByFileId.set(chunk.fileId, existing);
  }

  const denseRanking = dedupeByFileIdOrderedByDistance(denseChunks);
  const fused = reciprocalRankFusion([denseRanking, lexicalRanking]);

  const fusedWithFallback = await Promise.all(
    fused.map(async (item) => {
      if (chunksByFileId.has(item.id)) {
        return item;
      }
      const document = documentByFileId.get(item.id);
      if (document == null) {
        return item;
      }
      const chunks = await deps.denseSearchOne({
        query: input.query,
        fileId: item.id,
        entityId: document.spaceId,
        k: DENSE_K_PER_SPACE,
      });
      if (chunks.length > 0) {
        chunksByFileId.set(item.id, chunks);
      }
      return item;
    }),
  );

  const hits: KnowledgeSearchHit[] = [];
  for (const item of fusedWithFallback) {
    const document = documentByFileId.get(item.id);
    if (document == null) {
      continue;
    }
    const chunks = [...(chunksByFileId.get(item.id) ?? [])]
      .filter((chunk) => chunk.content.trim().length >= tuning.minChunkLength)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_CHUNKS_PER_DOCUMENT);
    for (const chunk of chunks) {
      hits.push(toHit(chunk, document));
    }
  }

  const relevant = keepRelevant(hits, tuning).slice(0, MAX_HITS);
  if (relevant.length === 0) {
    logger.info(
      `[knowledge] Поиск не дал результата: пространств ${spaces.length}, документов ${documents.length}, ` +
        `плотных фрагментов ${denseChunks.length}, лексических документов ${lexicalRanking.length}`,
    );
  }
  return relevant;
}
