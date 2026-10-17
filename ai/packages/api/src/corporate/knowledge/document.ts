import path from 'path';
import { logger } from '@librechat/data-schemas';
import { bufferToOfficeHtml, officeHtmlBucket } from '~/files/documents/html';
import { requestUserId } from '~/admin/corporate/context';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { KnowledgeSpaceSource } from './access';

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

/** `file_id` документов базы знаний — это UUID v4, см. `randomUUID()` в `admin/corporate/knowledge.ts`. */
const FILE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OBJECT_STORAGE_PREFIX = 's3://';

/**
 * Поля документа, нужные для доступа и отдачи оригинала. Отдельный тип (а не
 * `IKnowledgeDocument` из data-schemas) держит модуль тестируемым без Mongo —
 * вызывающая сторона (`api/server/routes/office.js`) сама приводит документ
 * Mongoose к этой форме.
 */
export interface KnowledgeDocumentRecord {
  fileId: string;
  spaceId: string;
  title: string;
  filename: string;
  mimetype: string;
  bytes: number;
  storagePath: string;
  text: string;
}

export interface KnowledgeDocumentHandlersDeps {
  findDocumentByFileId: (fileId: string) => Promise<KnowledgeDocumentRecord | null>;
  resolveAllowedSpaces: (userId: string) => Promise<KnowledgeSpaceSource[]>;
  readOriginal: (storagePath: string) => Promise<Buffer>;
  /** Корень, вне которого `storagePath` из базы считается недоверенным. */
  uploadsRoot: string;
}

type ResolvedDocument = { ok: true; document: KnowledgeDocumentRecord; buffer: Buffer };
type ResolvedError = { ok: false; status: 400 | 403 | 404; error: string };

function isPdfDocument(filename: string, mimetype: string): boolean {
  return mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

/**
 * `storagePath` приходит из базы, а не от пользователя, но проверяется всё равно:
 * запись могла быть создана до появления валидации или подправлена напрямую в базе.
 * Путь вне корня загрузок отдаётся как 404, а не 400 — снаружи неотличимо от
 * отсутствующего документа.
 */
function isWithinUploadsRoot(storagePath: string, uploadsRoot: string): boolean {
  const resolvedRoot = path.resolve(uploadsRoot);
  const resolvedPath = path.resolve(storagePath);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);
}

function encodeFilenameStar(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(filename: string, download: boolean): string {
  const type = download ? 'attachment' : 'inline';
  return `${type}; filename*=UTF-8''${encodeFilenameStar(filename)}`;
}

/**
 * Общая часть обоих обработчиков: проверка формата `fileId`, поиск документа
 * (статус значения не имеет — архивный документ открывается так же, как активный),
 * проверка доступа к пространству и чтение оригинала с диска. Права — те же, что
 * у поиска: `resolveAllowedSpaces` из `access.ts`.
 */
async function loadAuthorizedDocument(
  deps: KnowledgeDocumentHandlersDeps,
  req: ServerRequest,
): Promise<ResolvedDocument | ResolvedError> {
  const { fileId } = req.params as { fileId: string };
  if (!FILE_ID_REGEX.test(fileId)) {
    return { ok: false, status: 400, error: 'Invalid file ID' };
  }

  const document = await deps.findDocumentByFileId(fileId);
  if (document == null) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  /**
   * Пустой идентификатор до проверки прав доходить не должен — маршрут стоит за
   * `requireJwtAuth`. Но `resolveAllowedSpaces('')` вернул бы не пустой список, а
   * все пространства без ограничения по отделам: пользователя нет, отдела нет,
   * а `allowedDepartments.length === 0` разрешает доступ всем. Отказ здесь
   * закрывает эту ветку на случай, если аутентификацию когда-нибудь снимут.
   */
  const userId = requestUserId(req);
  if (userId === '') {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const allowedSpaces = await deps.resolveAllowedSpaces(userId);
  if (!allowedSpaces.some((space) => space.id === document.spaceId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (
    !document.storagePath.startsWith(OBJECT_STORAGE_PREFIX) &&
    !isWithinUploadsRoot(document.storagePath, deps.uploadsRoot)
  ) {
    return { ok: false, status: 404, error: 'Not found' };
  }

  try {
    const buffer = await deps.readOriginal(document.storagePath);
    return { ok: true, document, buffer };
  } catch (error) {
    logger.warn('[knowledgeDocument] original file missing on disk:', error);
    return { ok: false, status: 404, error: 'Not found' };
  }
}

export function createKnowledgeDocumentHandlers(deps: KnowledgeDocumentHandlersDeps): {
  getDocumentFile: Handler;
  getDocumentPreview: Handler;
} {
  async function getDocumentFile(req: ServerRequest, res: Response): Promise<Response> {
    const resolved = await loadAuthorizedDocument(deps, req);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }

    const { document, buffer } = resolved;
    const { download } = req.query as { download?: string };
    res.setHeader('Content-Type', document.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Content-Disposition', contentDisposition(document.filename, download === '1'));
    return res.status(200).send(buffer);
  }

  /**
   * Выбор `kind` — см. контракт маршрута: PDF отдаётся отдельным запросом на
   * `/file`, остальные офисные форматы — самодостаточным HTML от
   * `bufferToOfficeHtml` (он уже санитизирован и защищён от zip-бомб), а если
   * конвертация недоступна или упала — уже извлечённым при загрузке текстом.
   * Падение конвертации не должно ронять запрос, поэтому ошибка только логируется.
   */
  async function getDocumentPreview(req: ServerRequest, res: Response): Promise<Response> {
    const resolved = await loadAuthorizedDocument(deps, req);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }

    const { document, buffer } = resolved;
    const base = {
      fileId: document.fileId,
      title: document.title,
      filename: document.filename,
      mimetype: document.mimetype,
      bytes: document.bytes,
    };

    if (isPdfDocument(document.filename, document.mimetype)) {
      return res.status(200).json({ ...base, kind: 'pdf' });
    }

    if (officeHtmlBucket(document.filename, document.mimetype) != null) {
      try {
        const html = await bufferToOfficeHtml(buffer, document.filename, document.mimetype);
        if (html != null) {
          return res.status(200).json({ ...base, kind: 'html', html });
        }
      } catch (error) {
        logger.warn('[knowledgeDocument] bufferToOfficeHtml failed, falling back to text:', error);
      }
    }

    return res.status(200).json({ ...base, kind: 'text', text: document.text });
  }

  return { getDocumentFile, getDocumentPreview };
}
