import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import {
  isAdminLevelRole,
  KNOWLEDGE_DOCUMENT_MAX_BYTES,
  SystemRoles,
} from 'librechat-data-provider';
import { requestUserId } from '~/admin/corporate/context';
import {
  deleteDocumentPermanently,
  deleteSpaceConflictCount,
  isDeleteSpaceConflict,
} from './delete';
import { parseEffectiveDate, validateSupersedesId } from './ingest';
import { isSupportedDocument } from './mime';
import { toKnowledgeDocumentItem } from './serialize';
import { removeUploadTemp } from './upload';
import type {
  CreateSpaceInput,
  IKnowledgeDocument,
  IKnowledgeSpace,
  ListDocumentsFilter,
  UpdateDocumentInput,
  UpdateSpaceInput,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { CallerDepartment } from '~/admin/corporate/departmentScope';
import type { ServerRequest } from '~/types/http';
import type { DeleteVectorsInput } from './delete';
import type { IngestInput, IngestResult } from './ingest';
import type { KnowledgeSpaceSource } from './access';

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_UPLOAD_BYTES = KNOWLEDGE_DOCUMENT_MAX_BYTES;

export interface EmployeeKnowledgeDeps {
  resolveAllowedSpaces: (userId: string) => Promise<KnowledgeSpaceSource[]>;
  resolveWritableSpaces: (userId: string) => Promise<KnowledgeSpaceSource[]>;
  listDocuments: (filter: ListDocumentsFilter) => Promise<IKnowledgeDocument[]>;
  getDocumentById: (id: string) => Promise<IKnowledgeDocument | null>;
  updateDocument: (id: string, fields: UpdateDocumentInput) => Promise<IKnowledgeDocument | null>;
  archiveDocument: (id: string) => Promise<IKnowledgeDocument | null>;
  /** Безвозвратное удаление — отдельно от `archiveDocument`: снимает векторы,
   *  запись и оригинал (§ `deleteDocumentPermanently`), доступно только тому, кто
   *  распоряжается пространством (см. `requireManageableSpace`), а не автору документа. */
  deleteDocument: (id: string) => Promise<boolean>;
  deleteVectors: (input: DeleteVectorsInput) => Promise<void>;
  ingest: (input: IngestInput) => Promise<IngestResult>;
  removeOriginal: (storagePath: string) => Promise<void>;
  /** Отдел вызывающего — нужен, только чтобы решить, в какой отдел уходит создаваемое
   *  пространство (§ createSpaceHandler); для остальных хендлеров не читается. */
  getUserPolicy: (userId: string) => Promise<CallerDepartment | null>;
  getSpaceById: (id: string) => Promise<IKnowledgeSpace | null>;
  createSpace: (fields: CreateSpaceInput) => Promise<IKnowledgeSpace>;
  updateSpace: (id: string, fields: UpdateSpaceInput) => Promise<IKnowledgeSpace | null>;
  deleteSpace: (id: string) => Promise<boolean>;
}

export interface EmployeeKnowledgeSpaceItem extends KnowledgeSpaceSource {
  canWrite: boolean;
  /** Может ли вызывающий переименовать/удалить это пространство — не то же самое,
   *  что `canWrite` (загружать документы): рядовой сотрудник с `canUploadKnowledge`
   *  пишет документы, но не распоряжается самим пространством. */
  canManage: boolean;
}

interface EmployeeSpaceFields {
  name?: string;
  description?: string;
}

function toEmployeeSpaceSummary(
  space: IKnowledgeSpace,
  canWrite: boolean,
  canManage: boolean,
): EmployeeKnowledgeSpaceItem {
  return {
    id: space._id.toString(),
    name: space.name,
    allowedDepartments: space.allowedDepartments.map((id) => id.toString()),
    enabled: space.enabled,
    canWrite,
    canManage,
  };
}

/** Управлять пространствами (создавать/переименовывать/удалять) может только
 *  глава отдела или админ-уровневая роль — в отличие от загрузки документов,
 *  флаг `canUploadKnowledge` здесь не в счёт. */
function canManageSpaces(role: string): boolean {
  return isAdminLevelRole(role) || role === SystemRoles.HEAD;
}

type SpaceDepartmentScope =
  | { ok: true; departmentId: string }
  | { ok: false; status: 403; error: string };

/**
 * В отличие от админского `resolveRequestDepartmentScope`, здесь админ-уровневая
 * роль не получает `departmentId: null` (= пространство «для всех» — привилегия
 * админки, design §2): у этого маршрута любой вызывающий, включая админа, создаёт
 * пространство строго в своём отделе, а без отдела получает 403.
 */
async function resolveEmployeeSpaceDepartment(
  deps: EmployeeKnowledgeDeps,
  role: string,
  userId: string,
): Promise<SpaceDepartmentScope> {
  if (!canManageSpaces(role)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const policy = await deps.getUserPolicy(userId);
  const departmentId = policy?.departmentId != null ? policy.departmentId.toString() : null;
  if (departmentId == null) {
    return {
      ok: false,
      status: 403,
      error: 'A department head must belong to a department to manage knowledge spaces',
    };
  }
  return { ok: true, departmentId };
}

/** Правка и удаление пространства требуют одновременно роли (§ canManageSpaces)
 *  и права записи в конкретное пространство (§ resolveWritableSpaces) — для главы
 *  второе сводится к «это пространство моего отдела». */
async function requireManageableSpace(
  deps: EmployeeKnowledgeDeps,
  req: ServerRequest,
  spaceId: string,
): Promise<boolean> {
  const role = req.user?.role ?? '';
  if (!canManageSpaces(role)) {
    return false;
  }
  return requireWritableSpace(deps, requestUserId(req), spaceId);
}

interface EmployeeDocumentFields {
  title?: string;
  description?: string;
  effectiveDate?: string | null;
  supersedesId?: string;
}

/** Глава и админ распоряжаются всем содержимым пространства, сотрудник — только своим. */
function canManageForeign(role: string): boolean {
  return role === SystemRoles.HEAD || isAdminLevelRole(role);
}

async function requireWritableSpace(
  deps: EmployeeKnowledgeDeps,
  userId: string,
  spaceId: string,
): Promise<boolean> {
  const writable = await deps.resolveWritableSpaces(userId);
  return writable.some((space) => space.id === spaceId);
}

function isDescriptionTooLong(description: string | undefined): boolean {
  return description !== undefined && description.length > MAX_DESCRIPTION_LENGTH;
}

const INVALID_EFFECTIVE_DATE = Symbol('invalid-effective-date');

/**
 * `undefined` — поле не пришло, дату не меняем. `null` (или пустая строка) — сотрудник
 * осознанно очищает дату. Иначе — либо валидная `Date`, либо `INVALID_EFFECTIVE_DATE`:
 * неразбираемую строку вроде «вчера» `parseEffectiveDate` тихо превращает в `null`, что
 * неотличимо от осознанной очистки, — здесь это отклоняется как отдельный случай.
 */
function parseEffectiveDateField(
  value: string | null | undefined,
): Date | null | undefined | typeof INVALID_EFFECTIVE_DATE {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value.trim() === '') {
    return null;
  }
  return parseEffectiveDate(value) ?? INVALID_EFFECTIVE_DATE;
}

type AuthorizedDocument =
  | { ok: true; document: IKnowledgeDocument }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Право распоряжаться уже существующим документом: пространство документа обязано
 * быть доступно на запись, и только потом — авторство: сотрудник трогает лишь свои
 * документы, глава и админ-уровневые роли — любые в своих пространствах. Порядок
 * значим: без пространства на запись авторство роли не играет. Общая для правки,
 * архивации и замены документа новой версией при загрузке — второй копии этого
 * правила в модуле быть не должно.
 */
async function canManageDocumentWrite(
  deps: EmployeeKnowledgeDeps,
  req: ServerRequest,
  document: IKnowledgeDocument,
): Promise<boolean> {
  const userId = requestUserId(req);
  if (!(await requireWritableSpace(deps, userId, document.spaceId.toString()))) {
    return false;
  }

  const role = req.user?.role ?? '';
  return canManageForeign(role) || document.uploadedBy.toString() === userId;
}

/**
 * Общая часть правки и архивации: сначала формат ID (иначе `getDocumentById` дошёл бы
 * до Mongoose `findById` с мусорной строкой и упал `CastError`-ом), затем существование,
 * и только потом — право распоряжаться документом (`canManageDocumentWrite`).
 */
async function authorizeDocumentForWrite(
  deps: EmployeeKnowledgeDeps,
  req: ServerRequest,
  documentId: string,
): Promise<AuthorizedDocument> {
  if (!isValidObjectIdString(documentId)) {
    return { ok: false, status: 400, error: 'Invalid document ID format' };
  }

  const document = await deps.getDocumentById(documentId);
  if (!document) {
    return { ok: false, status: 404, error: 'Document not found' };
  }

  if (!(await canManageDocumentWrite(deps, req, document))) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, document };
}

export function createEmployeeKnowledgeHandlers(deps: EmployeeKnowledgeDeps): {
  listSpaces: Handler;
  createSpace: Handler;
  updateSpace: Handler;
  deleteSpace: Handler;
  listDocuments: Handler;
  uploadDocument: Handler;
  updateDocument: Handler;
  archiveDocument: Handler;
  deleteDocument: Handler;
} {
  async function listSpacesHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = requestUserId(req);
      const role = req.user?.role ?? '';
      const [readable, writable] = await Promise.all([
        deps.resolveAllowedSpaces(userId),
        deps.resolveWritableSpaces(userId),
      ]);
      const writableIds = new Set(writable.map((space) => space.id));
      const roleCanManage = canManageSpaces(role);
      const spaces: EmployeeKnowledgeSpaceItem[] = readable.map((space) => ({
        ...space,
        canWrite: writableIds.has(space.id),
        canManage: roleCanManage && writableIds.has(space.id),
      }));

      return res.status(200).json({ spaces });
    } catch (error) {
      logger.error('[employeeKnowledge] listSpaces error:', error);
      return res.status(500).json({ error: 'Failed to list knowledge spaces' });
    }
  }

  async function createSpaceHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const userId = requestUserId(req);
      const role = req.user?.role ?? '';
      const scope = await resolveEmployeeSpaceDepartment(deps, role, userId);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const { name, description } = req.body as EmployeeSpaceFields;
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'Space name is required' });
      }
      if (isDescriptionTooLong(description)) {
        return res
          .status(400)
          .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      /** `allowedDepartments` из тела запроса не читается вовсе — design §2 требует
       *  подставлять отдел вызывающего сервером, а не проверять клиентское значение. */
      const space = await deps.createSpace({
        name: trimmedName,
        description,
        allowedDepartments: [scope.departmentId],
      });

      return res.status(201).json({ space: toEmployeeSpaceSummary(space, true, true) });
    } catch (error) {
      logger.error('[employeeKnowledge] createSpace error:', error);
      return res.status(500).json({ error: 'Failed to create knowledge space' });
    }
  }

  async function updateSpaceHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const space = await deps.getSpaceById(id);
      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      if (!(await requireManageableSpace(deps, req, id))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { name, description } = req.body as EmployeeSpaceFields;
      if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: 'Space name cannot be empty' });
      }
      if (isDescriptionTooLong(description)) {
        return res
          .status(400)
          .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      const fields: UpdateSpaceInput = {};
      if (name !== undefined) {
        fields.name = name.trim();
      }
      if (description !== undefined) {
        fields.description = description;
      }

      const updated = await deps.updateSpace(id, fields);
      if (!updated) {
        return res.status(404).json({ error: 'Space not found' });
      }

      return res.status(200).json({ space: toEmployeeSpaceSummary(updated, true, true) });
    } catch (error) {
      logger.error('[employeeKnowledge] updateSpace error:', error);
      return res.status(500).json({ error: 'Failed to update knowledge space' });
    }
  }

  /**
   * Семантика удаления повторяет админскую (`db.deleteSpace`): пустое пространство
   * удаляется, непустое — 409, потому что осиротевшие в pgvector векторы после
   * удаления пространства снять нечем. Своей версии «удалить пространство вместе
   * с документами» здесь нет — глава архивирует/удаляет документы отдельно.
   */
  async function deleteSpaceHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const space = await deps.getSpaceById(id);
      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      if (!(await requireManageableSpace(deps, req, id))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const deleted = await deps.deleteSpace(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Space not found' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      if (isDeleteSpaceConflict(error)) {
        /**
         * `documentCount` — отдельным полем, а не только в тексте `error`: клиент
         * строит свой локализованный текст (design §4), не показывает сырое
         * серверное сообщение. Число включает архивные документы — `deleteSpace`
         * считает их тоже; ответственность за верную формулировку — на клиенте.
         */
        return res.status(409).json({
          error: (error as Error).message,
          documentCount: deleteSpaceConflictCount(error),
        });
      }
      logger.error('[employeeKnowledge] deleteSpace error:', error);
      return res.status(500).json({ error: 'Failed to delete knowledge space' });
    }
  }

  /**
   * `includeArchived` расширяет выдачу до всех статусов (в этом потоке документы
   * бывают только `active`/`archived` — `draft` сюда не попадает, его расставляет
   * только админский `uploadDocumentHandler`). Действует только для тех, кто
   * распоряжается пространством — `requireManageableSpace` та же проверка, что и
   * у CRUD пространств; рядовой сотрудник видит архивные, только если сам архивировал
   * бы их с правом записи, но не управлением, — то есть никогда.
   */
  async function listDocumentsHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id: spaceId } = req.params as { id: string };
      if (!isValidObjectIdString(spaceId)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const userId = requestUserId(req);
      const readable = await deps.resolveAllowedSpaces(userId);
      if (!readable.some((space) => space.id === spaceId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { includeArchived } = (req.query ?? {}) as { includeArchived?: string };
      const wantsArchived = includeArchived === 'true' || includeArchived === '1';
      const canSeeArchived = wantsArchived && (await requireManageableSpace(deps, req, spaceId));

      const filter: ListDocumentsFilter = canSeeArchived
        ? { spaceId }
        : { spaceId, status: 'active' };
      const documents = await deps.listDocuments(filter);
      return res.status(200).json({ documents: documents.map(toKnowledgeDocumentItem) });
    } catch (error) {
      logger.error('[employeeKnowledge] listDocuments error:', error);
      return res.status(500).json({ error: 'Failed to list knowledge documents' });
    }
  }

  /**
   * Приём документа делает общий конвейер `ingestDocument` (`deps.ingest`) — здесь
   * только разбор запроса и права. Поля `version`, `source`, `owner`, `status` из
   * тела запроса сотрудника не читаются: сотрудник ими не распоряжается, `owner`
   * проставляется на уровне `office.js` именем загрузившего. `finally` чистит
   * временный файл multer при любом исходе — успех, отказ по правам или по формату
   * запроса; сам `ingestDocument` отвечает только за сохранённый оригинал, не за него.
   */
  async function uploadDocumentHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id: spaceId } = req.params as { id: string };
      if (!isValidObjectIdString(spaceId)) {
        return res.status(400).json({ error: 'Invalid space ID format' });
      }

      const body = req.body as EmployeeDocumentFields;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return res.status(400).json({ error: 'Document title is required' });
      }

      if (isDescriptionTooLong(body.description)) {
        return res
          .status(400)
          .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'File is required' });
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: 'File exceeds the 25 MB limit' });
      }

      if (!isSupportedDocument(file.originalname, file.mimetype)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      const userId = requestUserId(req);
      if (!(await requireWritableSpace(deps, userId, spaceId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      /**
       * `supersedesId` архивирует указанный документ — без проверки прав здесь
       * сотрудник, подставив чужой ID, заархивировал бы чужой документ в обход
       * правил `canManageDocumentWrite` (та же авторизация, что у правки и
       * архивации).
       */
      const supersedesValidation = await validateSupersedesId(deps, {
        rawSupersedesId: body.supersedesId,
        spaceId,
        canManage: (document) => canManageDocumentWrite(deps, req, document),
      });
      if (!supersedesValidation.ok) {
        return res.status(supersedesValidation.status).json({ error: supersedesValidation.error });
      }
      const supersedesId = supersedesValidation.supersedesId;

      const result = await deps.ingest({
        spaceId,
        userId,
        file,
        fields: {
          title,
          description: body.description,
          effectiveDate: body.effectiveDate,
          supersedesId,
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
      logger.error('[employeeKnowledge] uploadDocument error:', error);
      return res.status(500).json({ error: 'Failed to upload document' });
    } finally {
      await removeUploadTemp(deps.removeOriginal, req.file?.path);
    }
  }

  async function updateDocumentHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as EmployeeDocumentFields;

      const trimmedTitle = typeof body.title === 'string' ? body.title.trim() : undefined;
      if (body.title !== undefined && trimmedTitle === '') {
        return res.status(400).json({ error: 'Document title is required' });
      }

      if (isDescriptionTooLong(body.description)) {
        return res
          .status(400)
          .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      const effectiveDate = parseEffectiveDateField(body.effectiveDate);
      if (effectiveDate === INVALID_EFFECTIVE_DATE) {
        return res.status(400).json({ error: 'Invalid effective date' });
      }

      const authorized = await authorizeDocumentForWrite(deps, req, id);
      if (!authorized.ok) {
        return res.status(authorized.status).json({ error: authorized.error });
      }

      const fields: UpdateDocumentInput = {};
      if (trimmedTitle !== undefined) {
        fields.title = trimmedTitle;
      }
      if (body.description !== undefined) {
        fields.description = body.description;
      }
      if (effectiveDate !== undefined) {
        fields.effectiveDate = effectiveDate;
      }

      const updated = await deps.updateDocument(id, fields);
      if (!updated) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.status(200).json({ document: toKnowledgeDocumentItem(updated) });
    } catch (error) {
      logger.error('[employeeKnowledge] updateDocument error:', error);
      return res.status(500).json({ error: 'Failed to update document' });
    }
  }

  async function archiveDocumentHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      const authorized = await authorizeDocumentForWrite(deps, req, id);
      if (!authorized.ok) {
        return res.status(authorized.status).json({ error: authorized.error });
      }

      const archived = await deps.archiveDocument(id);
      if (!archived) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.status(200).json({ document: toKnowledgeDocumentItem(archived) });
    } catch (error) {
      logger.error('[employeeKnowledge] archiveDocument error:', error);
      return res.status(500).json({ error: 'Failed to archive document' });
    }
  }

  /**
   * Безвозвратное удаление — отдельная авторизация от `authorizeDocumentForWrite`
   * (правка/архивация): там достаточно быть автором документа в доступном на
   * запись пространстве, здесь — только тот, кто распоряжается самим пространством
   * (`requireManageableSpace`, та же проверка, что у CRUD пространств). Автор
   * документа без роли HEAD/админ не может удалить и свой собственный документ —
   * только заархивировать.
   */
  async function deleteDocumentHandler(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid document ID format' });
      }

      const document = await deps.getDocumentById(id);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (!(await requireManageableSpace(deps, req, document.spaceId.toString()))) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const userId = requestUserId(req);
      const outcome = await deleteDocumentPermanently(deps, document, userId);
      if (!outcome.ok) {
        return res.status(502).json({ error: 'Failed to remove document vectors' });
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[employeeKnowledge] deleteDocument error:', error);
      return res.status(500).json({ error: 'Failed to delete document' });
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
    archiveDocument: archiveDocumentHandler,
    deleteDocument: deleteDocumentHandler,
  };
}
