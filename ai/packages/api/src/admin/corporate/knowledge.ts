import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import {
  ingestDocument,
  parseEffectiveDate,
  validateSupersedesId,
} from '~/corporate/knowledge/ingest';
import { deleteDocumentPermanently, isDeleteSpaceConflict } from '~/corporate/knowledge/delete';
import { normalizeForIndexing } from '~/corporate/knowledge/text';
import { isSupportedDocument } from '~/corporate/knowledge/mime';
import { toKnowledgeDocumentItem } from '~/corporate/knowledge/serialize';
import { removeUploadTemp } from '~/corporate/knowledge/upload';
import { requestUserId } from './context';
import { resolveRequestDepartmentScope } from './departmentScope';
import { resolveHeadSpaceDepartments } from './spacesValidation';
import type { FilterQuery } from 'mongoose';
import type { DeleteVectorsInput } from '~/corporate/knowledge/delete';
import type { SpaceOverrides } from '~/corporate/knowledge/access';
import type { CallerDepartment } from './departmentScope';
import type {
  CreateDocumentInput,
  CreateSpaceInput,
  IKnowledgeDocument,
  IKnowledgeSpace,
  IUser,
  KnowledgeStatus,
  ListDocumentsFilter,
  RecordUsageInput,
  UpdateDocumentInput,
  UpdateSpaceInput,
} from '@librechat/data-schemas';
import type { KnowledgeDocumentItem, KnowledgeSpaceItem } from 'librechat-data-provider';
import type { Response } from 'express';
import type {
  EmbedInput,
  ExtractInput,
  ExtractedTextProblem,
  SaveOriginalInput,
} from '~/corporate/knowledge/ingest';
import type { ServerRequest } from '~/types/http';

export {
  extractedTextProblem,
  describeExtractedTextProblem,
  MIN_DOCUMENT_TEXT_LENGTH,
  MIN_PLAIN_TEXT_LENGTH,
  MAX_UNREADABLE_RATIO,
} from '~/corporate/knowledge/ingest';
export type { EmbedInput, ExtractInput, ExtractedTextProblem, SaveOriginalInput };

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface SpaceFieldsInput {
  name?: string;
  description?: string;
  allowedDepartments?: string[];
  enabled?: boolean;
}

/**
 * `findUsers` возвращает `.lean()`-документы: обычные объекты только с `_id`, без
 * mongoose-виртуала `id` — такая типизация превращает случайное чтение `.id` в ошибку
 * компиляции, а не в тихий `undefined`. Приём повторяет соседние админские обработчики
 * (`spend.ts`, `limitRequests.ts`).
 */
type LeanUser = Omit<IUser, 'id'>;

export interface CorporateKnowledgeDeps {
  listSpaces: () => Promise<IKnowledgeSpace[]>;
  getSpaceById: (id: string) => Promise<IKnowledgeSpace | null>;
  createSpace: (fields: CreateSpaceInput) => Promise<IKnowledgeSpace>;
  updateSpace: (id: string, fields: UpdateSpaceInput) => Promise<IKnowledgeSpace | null>;
  deleteSpace: (id: string) => Promise<boolean>;
  countDocumentsBySpace: () => Promise<Map<string, number>>;
  listDocuments: (filter: ListDocumentsFilter) => Promise<IKnowledgeDocument[]>;
  getDocumentById: (id: string) => Promise<IKnowledgeDocument | null>;
  createDocument: (fields: CreateDocumentInput) => Promise<IKnowledgeDocument>;
  updateDocument: (id: string, fields: UpdateDocumentInput) => Promise<IKnowledgeDocument | null>;
  deleteDocument: (id: string) => Promise<boolean>;
  archiveDocument: (id: string) => Promise<IKnowledgeDocument | null>;
  extractText: (input: ExtractInput) => Promise<string>;
  embedDocument: (input: EmbedInput) => Promise<{ embedded: boolean }>;
  deleteVectors: (input: DeleteVectorsInput) => Promise<void>;
  saveOriginal: (input: SaveOriginalInput) => Promise<string>;
  removeOriginal: (storagePath: string) => Promise<void>;
  /**
   * Читает байты оригинала для переиндексации — тем же способом, что и остальные
   * пути чтения (`GET /knowledge/documents/:fileId/file` и т. п.): дисковый путь читается
   * напрямую, `s3://...` — через S3-клиент. Нужен только когда у документа нет
   * сохранённого текста (см. `reindexSpaceHandler`) — иначе индексируется текст, а не файл.
   */
  readOriginal: (storagePath: string) => Promise<Buffer>;
  recordUsage: (input: RecordUsageInput) => Promise<void>;
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
  findUsers: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<LeanUser[]>;
  /**
   * Тот же персональный запрет, что `resolveWritableSpaces` уважает даже для
   * админ-уровневых ролей (design §5/задача 4) — без него `assertSpaceInScope`
   * пропускала бы вызывающего с `deniedSpaces` в этот же роутер, и запрет на
   * странице сотрудника не действовал бы через админку.
   */
  getSpaceOverrides: (userId: string) => Promise<SpaceOverrides>;
}

/**
 * Пространство приходит из Mongoose — собственных перечисляемых свойств у документа нет,
 * значения отдаёт прототип. Собирается по ключам, как `toAdminLimits` в `serialize.ts`.
 */
function toKnowledgeSpaceItem(space: IKnowledgeSpace, documentCount: number): KnowledgeSpaceItem {
  return {
    id: space._id.toString(),
    name: space.name,
    description: space.description ?? '',
    allowedDepartments: space.allowedDepartments.map((id) => id.toString()),
    embeddingModel: space.embeddingModel,
    enabled: space.enabled,
    documentCount,
  };
}

/**
 * Одним запросом разрешает id загрузивших в отображаемые имена — тем же приёмом, что
 * `buildUserNameMap` в `spend.ts` и `limitRequests.ts`: `findUsers` с `$in` по всем id
 * страницы документов, а не по одному запросу на документ. Если у сотрудника нет имени,
 * берётся почта, как на тех же экранах; уволенный или удалённый пользователь просто
 * отсутствует в карте, и колонка на клиенте остаётся пустой.
 */
async function buildUploaderNameMap(
  findUsers: CorporateKnowledgeDeps['findUsers'],
  uploaderIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(uploaderIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const users = await findUsers({ _id: { $in: uniqueIds } }, 'name email');
  return new Map(users.map((user) => [user._id.toString(), user.name || user.email]));
}

function withUploaderName(
  item: KnowledgeDocumentItem,
  nameMap: Map<string, string>,
): KnowledgeDocumentItem {
  const uploadedByName = nameMap.get(item.uploadedBy);
  return uploadedByName === undefined ? item : { ...item, uploadedByName };
}

/**
 * Пространство считается «своим» для главы только если её отдел явно перечислен в
 * `allowedDepartments` — пустой список («для всех») своим не считается.
 */
export function spaceAllowsDepartment(space: IKnowledgeSpace, departmentId: string): boolean {
  return space.allowedDepartments.some((id) => id.toString() === departmentId);
}

/**
 * Персональный запрет проверяется первым и для всех ролей без исключения: он
 * сильнее роли, как и в `resolveWritableSpaces`, — иначе admin/owner с `deniedSpaces`
 * на пространство продолжали бы распоряжаться им через этот роутер, хотя со страницы
 * сотрудника кнопка загрузки для них уже пропала. Department-проверка идёт дальше и,
 * как раньше, касается только главы: admin-level вызывающие передают
 * `departmentId: null` и не платят лишним чтением пространства.
 */
async function assertSpaceInScope(
  getSpaceById: CorporateKnowledgeDeps['getSpaceById'],
  spaceId: string,
  departmentId: string | null,
  deniedSpaceIds: Set<string>,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  if (deniedSpaceIds.has(spaceId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (departmentId == null) {
    return { ok: true };
  }
  const space = await getSpaceById(spaceId);
  if (!space) {
    return { ok: false, status: 404, error: 'Space not found' };
  }
  if (!spaceAllowsDepartment(space, departmentId)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

async function resolveDeniedSpaceIds(
  getSpaceOverrides: CorporateKnowledgeDeps['getSpaceOverrides'],
  userId: string,
): Promise<Set<string>> {
  const overrides = await getSpaceOverrides(userId);
  return new Set(overrides.deniedSpaces);
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface UploadDocumentBody {
  title?: string;
  description?: string;
  source?: string;
  owner?: string;
  version?: string;
  effectiveDate?: string | null;
  status?: KnowledgeStatus;
  supersedesId?: string | null;
}

const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = ['active', 'archived', 'draft'];

/**
 * `status` — закрытый список значений в схеме документа, но `deps.updateDocument`
 * пишет через `findByIdAndUpdate` без включённых валидаторов, так что перечисление
 * из схемы не срабатывает: опечатка в статусе тихо сохранялась бы как есть, и
 * документ выпадал бы и из поиска, и из фильтра по статусу в админке — вернуть его
 * оттуда было бы нечем, только правкой в базе напрямую.
 */
function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  return typeof value === 'string' && (KNOWLEDGE_STATUSES as readonly string[]).includes(value);
}

export function createCorporateKnowledgeHandlers(deps: CorporateKnowledgeDeps): {
  listSpaces: Handler;
  createSpace: Handler;
  updateSpace: Handler;
  deleteSpace: Handler;
  listDocuments: Handler;
  uploadDocument: Handler;
  updateDocument: Handler;
  deleteDocument: Handler;
  reindexSpace: Handler;
} {
  async function listSpacesHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const [spaces, counts] = await Promise.all([deps.listSpaces(), deps.countDocumentsBySpace()]);
      const { departmentId } = scope;
      const visibleSpaces =
        departmentId == null
          ? spaces
          : spaces.filter((space) => spaceAllowsDepartment(space, departmentId));
      return res.status(200).json({
        spaces: visibleSpaces.map((space) =>
          toKnowledgeSpaceItem(space, counts.get(space._id.toString()) ?? 0),
        ),
      });
    } catch (error) {
      logger.error('[corporateKnowledge] listSpaces error:', error);
      return res.status(500).json({ error: 'Failed to list knowledge spaces' });
    }
  }

  /**
   * Глава отдела может создавать пространства, но только в границах своего отдела:
   * `resolveHeadSpaceDepartments` не пускает ни пустой список (= видно всем), ни
   * чужие отделы. Админ и владелец задают `allowedDepartments` как раньше, без
   * ограничений — `scope.departmentId` для них `null`.
   */
  async function createSpaceHandler(req: ServerRequest, res: Response) {
    try {
      const scope = await resolveRequestDepartmentScope(
        deps,
        req.user?.role ?? '',
        requestUserId(req),
      );
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { name, description, allowedDepartments, enabled } = req.body as SpaceFieldsInput;
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'Space name is required' });
      }

      let resolvedAllowedDepartments = allowedDepartments;
      if (scope.departmentId != null) {
        const headScope = resolveHeadSpaceDepartments(allowedDepartments, scope.departmentId);
        if (!headScope.ok) {
          return res.status(400).json({ error: headScope.error });
        }
        resolvedAllowedDepartments = headScope.allowedDepartments;
      }

      const space = await deps.createSpace({
        name: trimmedName,
        description,
        allowedDepartments: resolvedAllowedDepartments,
        enabled,
      });

      return res.status(201).json({ space: toKnowledgeSpaceItem(space, 0) });
    } catch (error) {
      logger.error('[corporateKnowledge] createSpace error:', error);
      return res.status(500).json({ error: 'Failed to create knowledge space' });
    }
  }

  /**
   * Глава может редактировать только пространства своего отдела — та же проверка
   * области видимости (`assertSpaceInScope`, с личным `deniedSpaces` вперёд роли),
   * что и для документов. Расширить `allowedDepartments` за пределы своего отдела
   * или обнулить его (= сделать общедоступным) она не может: `resolveHeadSpaceDepartments`
   * отклоняет любое значение, кроме `[её отдел]`.
   */
  async function updateSpaceHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, callerId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        id,
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const { name, description, allowedDepartments, enabled } = req.body as SpaceFieldsInput;
      if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: 'Space name cannot be empty' });
      }

      let resolvedAllowedDepartments = allowedDepartments;
      if (scope.departmentId != null && allowedDepartments !== undefined) {
        const headScope = resolveHeadSpaceDepartments(allowedDepartments, scope.departmentId);
        if (!headScope.ok) {
          return res.status(400).json({ error: headScope.error });
        }
        resolvedAllowedDepartments = headScope.allowedDepartments;
      }

      const fields: UpdateSpaceInput = {};
      if (name !== undefined) {
        fields.name = name.trim();
      }
      if (description !== undefined) {
        fields.description = description;
      }
      if (resolvedAllowedDepartments !== undefined) {
        fields.allowedDepartments = resolvedAllowedDepartments;
      }
      if (enabled !== undefined) {
        fields.enabled = enabled;
      }

      const [updated, counts] = await Promise.all([
        deps.updateSpace(id, fields),
        deps.countDocumentsBySpace(),
      ]);
      if (!updated) {
        return res.status(404).json({ error: 'Space not found' });
      }

      return res.status(200).json({ space: toKnowledgeSpaceItem(updated, counts.get(id) ?? 0) });
    } catch (error) {
      logger.error('[corporateKnowledge] updateSpace error:', error);
      return res.status(500).json({ error: 'Failed to update knowledge space' });
    }
  }

  /**
   * Осиротевшие в pgvector векторы после удаления пространства не найти и не снять —
   * поэтому `deps.deleteSpace` бросает, пока в нём есть документы, и это отражается 409,
   * а не 500: это ожидаемый отказ конфигурации, а не сбой сервера.
   */
  async function deleteSpaceHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, callerId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      /** Глава может удалить только пространство своего отдела — та же проверка, что при правке. */
      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        id,
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const deleted = await deps.deleteSpace(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Space not found' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      if (isDeleteSpaceConflict(error)) {
        return res.status(409).json({ error: (error as Error).message });
      }
      logger.error('[corporateKnowledge] deleteSpace error:', error);
      return res.status(500).json({ error: 'Failed to delete knowledge space' });
    }
  }

  async function listDocumentsHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, callerId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id: spaceId } = req.params as { id: string };
      if (!isValidObjectIdString(spaceId)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        spaceId,
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const { status } = req.query as { status?: string };
      const filter: ListDocumentsFilter = { spaceId };
      if (status !== undefined) {
        filter.status = status as KnowledgeStatus;
      }

      const documents = await deps.listDocuments(filter);
      const nameMap = await buildUploaderNameMap(
        deps.findUsers,
        documents.map((document) => document.uploadedBy.toString()),
      );
      return res.status(200).json({
        documents: documents.map((document) =>
          withUploaderName(toKnowledgeDocumentItem(document), nameMap),
        ),
      });
    } catch (error) {
      logger.error('[corporateKnowledge] listDocuments error:', error);
      return res.status(500).json({ error: 'Failed to list knowledge documents' });
    }
  }

  /**
   * Приём документа (сохранение оригинала, извлечение текста, эмбеддинг, запись в
   * MongoDB) делает общий конвейер `ingestDocument` — тут остаются только проверки,
   * относящиеся к разбору запроса.
   */
  async function uploadDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, callerId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id: spaceId } = req.params as { id: string };
      if (!isValidObjectIdString(spaceId)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        spaceId,
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'File is required' });
      }

      const body = req.body as UploadDocumentBody;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return res.status(400).json({ error: 'Document title is required' });
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: 'File exceeds the 25 MB limit' });
      }

      if (!isSupportedDocument(file.originalname, file.mimetype)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      if (body.status !== undefined && !isKnowledgeStatus(body.status)) {
        return res.status(400).json({ error: 'Unknown document status' });
      }

      /**
       * `supersedesId` архивирует указанный документ, поэтому его нельзя принимать
       * непроверенным: формат, существование и принадлежность тому же пространству
       * проверяет `validateSupersedesId`. Отдельной проверки прав вызывающего здесь
       * не нужно — пространство загрузки уже прошло `assertSpaceInScope` выше, а
       * заменяемый документ обязан лежать в этом же пространстве, так что он уже
       * покрыт той же проверкой области видимости.
       */
      const supersedesValidation = await validateSupersedesId(deps, {
        rawSupersedesId: body.supersedesId,
        spaceId,
        canManage: async () => true,
      });
      if (!supersedesValidation.ok) {
        return res.status(supersedesValidation.status).json({ error: supersedesValidation.error });
      }

      const result = await ingestDocument(deps, {
        spaceId,
        userId: requestUserId(req),
        file,
        fields: {
          title,
          description: body.description,
          effectiveDate: body.effectiveDate,
          version: body.version,
          source: body.source,
          owner: body.owner,
          status: body.status,
          supersedesId: supersedesValidation.supersedesId,
        },
      });

      if (!result.ok) {
        return res
          .status(result.status)
          .json(
            result.reason
              ? { error: result.error, reason: result.reason }
              : { error: result.error },
          );
      }

      return res.status(201).json({ document: toKnowledgeDocumentItem(result.document) });
    } catch (error) {
      logger.error('[corporateKnowledge] uploadDocument error:', error);
      return res.status(500).json({ error: 'Failed to upload document' });
    } finally {
      await removeUploadTemp(deps.removeOriginal, req.file?.path);
    }
  }

  async function updateDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const callerId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', callerId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, callerId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid document ID format' });
      }

      /**
       * Маршрут не несёт `spaceId`, только `id` документа — а персональный запрет
       * (как и отдел документа для главы) известен только через его пространство.
       * Документ теперь читается для всех ролей: раньше админ обходился без этого
       * чтения, но без него личный `deniedSpaces` вызывающего было бы нечем
       * проверить на этом маршруте.
       */
      const document = await deps.getDocumentById(id);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        document.spaceId.toString(),
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const body = req.body as UploadDocumentBody;
      const fields: UpdateDocumentInput = {};
      if (body.title !== undefined) {
        fields.title = body.title;
      }
      if (body.source !== undefined) {
        fields.source = body.source;
      }
      if (body.owner !== undefined) {
        fields.owner = body.owner;
      }
      if (body.version !== undefined) {
        fields.version = body.version;
      }
      if (body.effectiveDate !== undefined) {
        fields.effectiveDate = parseEffectiveDate(body.effectiveDate);
      }
      if (body.status !== undefined) {
        if (!isKnowledgeStatus(body.status)) {
          return res.status(400).json({ error: 'Unknown document status' });
        }
        fields.status = body.status;
      }
      if (body.supersedesId !== undefined) {
        /**
         * Тот же риск, что закрыт при загрузке (`validateSupersedesId`): без проверки
         * сюда ушёл бы формат-мусор или id документа из другого пространства. Здесь
         * это не архивирует чужой документ (`updateDocument` не имеет побочных
         * эффектов ingest-конвейера), но оставляло бы висячую или чужую ссылку.
         */
        const supersedesValidation = await validateSupersedesId(deps, {
          rawSupersedesId: body.supersedesId,
          spaceId: document.spaceId.toString(),
          canManage: async () => true,
        });
        if (!supersedesValidation.ok) {
          return res
            .status(supersedesValidation.status)
            .json({ error: supersedesValidation.error });
        }
        fields.supersedesId = supersedesValidation.supersedesId;
      }

      const updated = await deps.updateDocument(id, fields);
      if (!updated) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.status(200).json({ document: toKnowledgeDocumentItem(updated) });
    } catch (error) {
      logger.error('[corporateKnowledge] updateDocument error:', error);
      return res.status(500).json({ error: 'Failed to update document' });
    }
  }

  /**
   * Порядок и механика удаления — общие с роутером сотрудника, вынесены в
   * `deleteDocumentPermanently` (`~/corporate/knowledge/delete`); здесь остаются
   * только проверки, относящиеся к области видимости админского роутера.
   */
  async function deleteDocumentHandler(req: ServerRequest, res: Response) {
    try {
      const userId = requestUserId(req);
      const [scope, deniedSpaceIds] = await Promise.all([
        resolveRequestDepartmentScope(deps, req.user?.role ?? '', userId),
        resolveDeniedSpaceIds(deps.getSpaceOverrides, userId),
      ]);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid document ID format' });
      }

      const document = await deps.getDocumentById(id);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const spaceScope = await assertSpaceInScope(
        deps.getSpaceById,
        document.spaceId.toString(),
        scope.departmentId,
        deniedSpaceIds,
      );
      if (!spaceScope.ok) {
        return res.status(spaceScope.status).json({ error: spaceScope.error });
      }

      const outcome = await deleteDocumentPermanently(deps, document, userId);
      if (!outcome.ok) {
        return res.status(502).json({ error: 'Failed to remove document vectors' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[corporateKnowledge] deleteDocument error:', error);
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  }

  /**
   * Оригинал нужен как реальный файл, только когда у документа нет сохранённого текста:
   * с текстом `embedDocument` шлёт в `rag_api` буфер текста напрямую (см. `EmbedInput`),
   * а `filePath` в этом случае вообще не читается. Пишет во временный файл, а не отдаёт
   * буфер напрямую, — `rag.ts` стримит эмбеддинг и извлечение текста через путь на диске.
   */
  async function writeReindexTempFile(buffer: Buffer, filename: string): Promise<string> {
    const tempPath = path.join(os.tmpdir(), `reindex-${randomUUID()}-${filename}`);
    await fs.promises.writeFile(tempPath, buffer);
    return tempPath;
  }

  /**
   * Один документ падает — переиндексация пространства не прерывается: пропущенный
   * документ уходит в `skipped` с человекочитаемой причиной, а цикл продолжается со
   * следующего. Раньше это было не так: отсутствие `storagePath` у любого документа
   * (в том числе `s3://...`, ссылающийся на удалённый или ещё не перенесённый в MinIO
   * объект) отменяло переиндексацию всего пространства кодом 409.
   */
  async function reindexSpaceHandler(req: ServerRequest, res: Response) {
    try {
      /** Переиндексация не входит в перечисленные главе операции над знаниями отдела. */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { id: spaceId } = req.params as { id: string };
      if (!isValidObjectIdString(spaceId)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const space = await deps.getSpaceById(spaceId);
      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const documents = await deps.listDocuments({ spaceId });
      const userId = requestUserId(req);

      let reindexed = 0;
      const skipped: Array<{ title: string; reason: string }> = [];

      /**
       * `deleteVectors` вызывается по одному документу за раз, а не одним запросом на
       * все `file_id` пространства: удаление в `rag_api` атомарно на уровне пачки —
       * если хотя бы один `file_id` в пачке отсутствует, не удаляется ни один.
       */
      for (const document of documents) {
        if (!document.storagePath) {
          skipped.push({ title: document.title, reason: 'Оригинал документа не сохранён' });
          continue;
        }

        let tempFilePath: string | undefined;
        let stage = 'обработке документа';
        try {
          stage = 'удалении старых векторов';
          await deps.deleteVectors({ fileIds: [document.file_id], entityId: spaceId, userId });

          const text = document.text ? normalizeForIndexing(document.text) : undefined;
          let filePath = document.storagePath;
          if (text == null) {
            stage = 'чтении оригинала из хранилища';
            const buffer = await deps.readOriginal(document.storagePath);
            tempFilePath = await writeReindexTempFile(buffer, document.filename);
            filePath = tempFilePath;
          }

          stage = 'индексации документа';
          await deps.embedDocument({
            fileId: document.file_id,
            entityId: spaceId,
            filePath,
            filename: document.filename,
            mimetype: document.mimetype,
            text,
            userId,
          });
          await deps.updateDocument(document._id.toString(), {
            embeddingModel: space.embeddingModel,
          });
          reindexed += 1;
        } catch (error) {
          logger.error(
            `[corporateKnowledge] reindexSpace: сбой при ${stage} "${document.title}" (${document.file_id}), документ пропущен:`,
            error,
          );
          skipped.push({ title: document.title, reason: `Сбой при ${stage}` });
        } finally {
          if (tempFilePath) {
            await fs.promises.unlink(tempFilePath).catch(() => {});
          }
        }
      }

      return res.status(200).json({ reindexed, skipped });
    } catch (error) {
      logger.error('[corporateKnowledge] reindexSpace error:', error);
      return res.status(500).json({ error: 'Failed to reindex space' });
    }
  }

  return {
    listSpaces: listSpacesHandler,
    createSpace: createSpaceHandler,
    updateSpace: updateSpaceHandler,
    deleteSpace: deleteSpaceHandler,
    listDocuments: listDocumentsHandler,
    uploadDocument: uploadDocumentHandler,
    updateDocument: updateDocumentHandler,
    deleteDocument: deleteDocumentHandler,
    reindexSpace: reindexSpaceHandler,
  };
}
