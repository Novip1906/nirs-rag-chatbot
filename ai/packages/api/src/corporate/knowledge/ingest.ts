import { randomUUID } from 'crypto';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import { normalizeForIndexing } from './text';
import { fileExtension } from './mime';
import type {
  CreateDocumentInput,
  IKnowledgeDocument,
  IKnowledgeSpace,
  KnowledgeStatus,
  RecordUsageInput,
} from '@librechat/data-schemas';

export interface ExtractInput {
  fileId: string;
  filePath: string;
  filename: string;
  mimetype: string;
  userId: string;
}

export interface EmbedInput {
  fileId: string;
  entityId: string;
  filePath: string;
  filename: string;
  mimetype: string;
  /**
   * Нормализованный текст документа. Передаётся вместо файла, чтобы `rag_api`
   * не резал презентационные PDF на строки-обрывки — см. `normalizeForIndexing`.
   */
  text?: string;
  userId: string;
}

export interface SaveOriginalInput {
  spaceId: string;
  fileId: string;
  sourcePath: string;
  extension: string;
}

export interface IngestDeps {
  getSpaceById: (id: string) => Promise<IKnowledgeSpace | null>;
  saveOriginal: (input: SaveOriginalInput) => Promise<string>;
  removeOriginal: (storagePath: string) => Promise<void>;
  extractText: (input: ExtractInput) => Promise<string>;
  embedDocument: (input: EmbedInput) => Promise<{ embedded: boolean }>;
  createDocument: (fields: CreateDocumentInput) => Promise<IKnowledgeDocument>;
  archiveDocument: (id: string) => Promise<IKnowledgeDocument | null>;
  recordUsage: (input: RecordUsageInput) => Promise<void>;
}

/**
 * Лимит MongoDB на размер записи — 16 МБ. Порог берётся с запасом (15 млн символов текста,
 * а не байт извлечённого из документа), потому что помимо `text` в тот же документ пишутся
 * остальные поля, а UTF-8 может занимать больше байта на символ.
 */
const MAX_DOCUMENT_TEXT_LENGTH = 15_000_000;

/**
 * Извлечение текста возвращает строку даже когда разобрать файл не удалось:
 * из документа на несколько мегабайт приходило 17 байт вида
 * `\t\0\0\0\0\0\0\0 1.60.1.7s`. Такой документ молча становился активным,
 * занимал место в выдаче и никогда не находился по существу — а сотрудник
 * получал ответ по постороннему документу вместо «в базе этого нет».
 */
export const MIN_DOCUMENT_TEXT_LENGTH = 200;
/**
 * У `.txt`/`.md`/`.csv` текст — это и есть содержимое файла, а не результат
 * распознавания/парсера: там неоткуда взяться шуму, который отсекает основной
 * порог у PDF/DOCX/PPTX (скан, повреждённый парсер и т.п.). Короткая служебная
 * записка или чек-лист на пару десятков символов — уже полноценный документ, а
 * не мусор, поэтому порог для простых текстовых форматов ниже.
 */
export const MIN_PLAIN_TEXT_LENGTH = 20;
export const MAX_UNREADABLE_RATIO = 0.05;

const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv']);

export type ExtractedTextProblem = 'too_short' | 'unreadable';

function isPlainTextFormat(filename: string): boolean {
  return PLAIN_TEXT_EXTENSIONS.has(fileExtension(filename));
}

function unreadableRatio(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  let unreadable = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) {
      continue;
    }
    if (code < 32 || code === 0x7f || code === 0xfffd) {
      unreadable++;
    }
  }
  return unreadable / text.length;
}

export function extractedTextProblem(text: string, filename: string): ExtractedTextProblem | null {
  if (unreadableRatio(text) > MAX_UNREADABLE_RATIO) {
    return 'unreadable';
  }
  const minLength = isPlainTextFormat(filename) ? MIN_PLAIN_TEXT_LENGTH : MIN_DOCUMENT_TEXT_LENGTH;
  if (text.trim().length < minLength) {
    return 'too_short';
  }
  return null;
}

/**
 * Русский текст отказа для `reason`, общий для загрузки в базу знаний
 * (`ingestDocument`) и в проект (`documents/handlers.ts`) — раньше проектная
 * загрузка отвечала одной и той же формулировкой «похоже, это скан» на любую
 * причину, хотя `too_short` для `.txt`/`.md`/`.csv` никакого скана не подразумевает:
 * там извлекать нечего, текст короткий сам по себе. `unreadable` — действительно
 * повреждённый файл или нечитаемый парсером формат, независимо от расширения.
 */
export function describeExtractedTextProblem(
  problem: ExtractedTextProblem,
  filename: string,
): string {
  if (problem === 'unreadable') {
    return 'Не удалось прочитать текст документа: файл повреждён или сохранён в неподдерживаемом формате. Пересохраните его и загрузите снова.';
  }
  if (isPlainTextFormat(filename)) {
    return `Документ слишком короткий для индексации: нужно не меньше ${MIN_PLAIN_TEXT_LENGTH} символов текста.`;
  }
  return 'В документе почти нет текста. Возможно, это скан или файл с изображениями — распознайте текст и загрузите снова.';
}

export function parseEffectiveDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface SupersedesDeps {
  getDocumentById: (id: string) => Promise<IKnowledgeDocument | null>;
}

export type SupersedesValidation =
  | { ok: true; supersedesId: string | null }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Проверяет `supersedesId` перед приёмом документа: формат, существование,
 * принадлежность тому же пространству, куда идёт загрузка, и — через `canManage` —
 * право вызывающего распоряжаться заменяемым документом. Общая для маршрута
 * сотрудника и админского: раньше она жила только в одном из них, и это
 * расхождение позволяло главе отдела заархивировать через админскую загрузку
 * любой документ компании, включая чужого отдела.
 */
export async function validateSupersedesId(
  deps: SupersedesDeps,
  input: {
    rawSupersedesId: string | null | undefined;
    spaceId: string;
    canManage: (document: IKnowledgeDocument) => Promise<boolean>;
  },
): Promise<SupersedesValidation> {
  const trimmed = typeof input.rawSupersedesId === 'string' ? input.rawSupersedesId.trim() : '';
  if (trimmed === '') {
    return { ok: true, supersedesId: null };
  }

  if (!isValidObjectIdString(trimmed)) {
    return { ok: false, status: 400, error: 'Invalid supersedesId format' };
  }

  const document = await deps.getDocumentById(trimmed);
  if (!document) {
    return { ok: false, status: 404, error: 'Document to supersede not found' };
  }

  if (document.spaceId.toString() !== input.spaceId) {
    return { ok: false, status: 400, error: 'Document to supersede belongs to a different space' };
  }

  if (!(await input.canManage(document))) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, supersedesId: trimmed };
}

export interface IngestInput {
  spaceId: string;
  userId: string;
  file: { path: string; originalname: string; mimetype: string; size: number };
  fields: {
    title: string;
    description?: string;
    effectiveDate?: string | null;
    version?: string;
    source?: string;
    owner?: string;
    status?: KnowledgeStatus;
    supersedesId?: string | null;
  };
}

export type IngestResult =
  | { ok: true; document: IKnowledgeDocument }
  | { ok: false; status: 400 | 404 | 502; error: string; reason?: ExtractedTextProblem };

/**
 * Общий конвейер приёма документа базы знаний: используется и админской загрузкой,
 * и (в дальнейшем) роутером сотрудника. Порядок операций значим и менять его нельзя:
 * оригинал сохраняется на диск раньше всего, чтобы `removeOriginal` было чем откатывать,
 * если извлечение текста или эмбеддинг упадут; запись в MongoDB создаётся только после
 * успешного эмбеддинга, иначе в базе появился бы документ, которого нет в pgvector;
 * заменяемый документ архивируется после создания нового, а не до.
 */
export async function ingestDocument(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { spaceId, userId, file, fields } = input;

  const space = await deps.getSpaceById(spaceId);
  if (!space) {
    return { ok: false, status: 404, error: 'Space not found' };
  }

  const fileId = randomUUID();

  const storagePath = await deps.saveOriginal({
    spaceId,
    fileId,
    sourcePath: file.path,
    extension: fileExtension(file.originalname),
  });

  let text: string;
  try {
    text = await deps.extractText({
      fileId,
      filePath: file.path,
      filename: file.originalname,
      mimetype: file.mimetype,
      userId,
    });
  } catch (error) {
    await deps.removeOriginal(storagePath);
    logger.error('[ingestDocument] extractText error:', error);
    return { ok: false, status: 502, error: 'Failed to extract document text' };
  }

  if (text.length > MAX_DOCUMENT_TEXT_LENGTH) {
    await deps.removeOriginal(storagePath);
    return { ok: false, status: 400, error: 'Document text exceeds the MongoDB record size limit' };
  }

  const textProblem = extractedTextProblem(text, file.originalname);
  if (textProblem != null) {
    await deps.removeOriginal(storagePath);
    return {
      ok: false,
      status: 400,
      error: describeExtractedTextProblem(textProblem, file.originalname),
      reason: textProblem,
    };
  }

  let embedResult: { embedded: boolean };
  try {
    embedResult = await deps.embedDocument({
      fileId,
      entityId: spaceId,
      filePath: file.path,
      filename: file.originalname,
      mimetype: file.mimetype,
      text: normalizeForIndexing(text),
      userId,
    });
  } catch (error) {
    await deps.removeOriginal(storagePath);
    logger.error('[ingestDocument] embedDocument error:', error);
    return { ok: false, status: 502, error: 'Failed to index document' };
  }

  const supersedesId = fields.supersedesId ?? null;

  const document = await deps.createDocument({
    spaceId,
    file_id: fileId,
    title: fields.title,
    description: fields.description,
    filename: file.originalname,
    source: fields.source ?? '',
    owner: fields.owner ?? '',
    version: fields.version ?? '',
    effectiveDate: parseEffectiveDate(fields.effectiveDate),
    status: fields.status ?? 'active',
    supersedesId,
    embeddingModel: space.embeddingModel,
    storagePath,
    text,
    bytes: file.size,
    mimetype: file.mimetype,
    /**
     * `rag_api` может ответить `HTTP 200` на `/embed`, даже не записав ни одного
     * фрагмента в pgvector (внутренний сбой пайплайна вставки, пойманный и
     * залогированный самим `rag_api`, но не превращённый в код ошибки) — тогда
     * `embedDocument` вернёт `embedded: false` без исключения. Раньше это поле
     * писалось литералом `true` независимо от ответа: документ становился
     * «проиндексированным» в Mongo, а искать по нему было нечего. Тот же контракт
     * (`embedded` из ответа rag_api, а не литерал) уже используется соседним
     * `documents/handlers.ts` для проектных документов.
     */
    embedded: embedResult.embedded,
    uploadedBy: userId,
  });

  if (supersedesId) {
    await deps.archiveDocument(supersedesId);
  }

  await deps.recordUsage({
    userId,
    scenario: 'kb_index',
    model: space.embeddingModel,
    costUsd: 0,
    costSource: 'unknown',
    promptTokens: 0,
    completionTokens: 0,
  });

  return { ok: true, document };
}
