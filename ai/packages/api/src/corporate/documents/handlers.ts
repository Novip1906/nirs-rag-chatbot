import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { isValidObjectIdString, logger } from '@librechat/data-schemas';
import type { CreateProjectDocumentInput, IProjectDocument } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { fileExtension, isSupportedDocument } from '~/corporate/knowledge/mime';
import { extractedTextProblem, describeExtractedTextProblem } from '~/admin/corporate/knowledge';
import { requestUserId } from '~/admin/corporate/context';

type Handler = (req: ServerRequest, res: Response) => Promise<Response>;

export const MAX_DOCUMENTS_PER_PROJECT: number = 20;
export const MAX_BYTES_PER_USER: number = 200 * 1024 * 1024;

export interface ProjectDocumentDeps {
  getChatProject: (owner: string, projectId: string) => Promise<{ _id: unknown } | null>;
  listProjectDocuments: (owner: string, projectId: string) => Promise<IProjectDocument[]>;
  getProjectDocument: (owner: string, fileId: string) => Promise<IProjectDocument | null>;
  countProjectDocuments: (owner: string, projectId: string) => Promise<number>;
  sumProjectDocumentBytes: (owner: string) => Promise<number>;
  createProjectDocument: (input: CreateProjectDocumentInput) => Promise<IProjectDocument>;
  markProjectDocumentEmbedded: (
    owner: string,
    fileId: string,
    embedded: boolean,
  ) => Promise<IProjectDocument | null>;
  deleteProjectDocument: (owner: string, fileId: string) => Promise<IProjectDocument | null>;
  extractText: (input: {
    fileId: string;
    filePath: string;
    filename: string;
    mimetype: string;
    userId: string;
  }) => Promise<string>;
  embedDocument: (input: {
    fileId: string;
    entityId: string;
    filePath: string;
    filename: string;
    mimetype: string;
    text: string;
    userId: string;
  }) => Promise<{ embedded: boolean }>;
  deleteVectors: (input: { fileIds: string[]; entityId: string; userId: string }) => Promise<void>;
  saveOriginal: (input: {
    projectId: string;
    fileId: string;
    sourcePath: string;
    extension: string;
  }) => Promise<string>;
  removeOriginal: (storagePath: string) => Promise<void>;
  countTokens: (text: string) => Promise<number>;
  recordUsage: (input: {
    userId: string;
    scenario: string;
    model: string;
    costUsd: number;
    costSource: string;
    promptTokens: number;
    completionTokens: number;
  }) => Promise<unknown>;
}

interface ProjectDocumentItem {
  fileId: string;
  title: string;
  filename: string;
  mimetype: string;
  bytes: number;
  tokenCount: number;
  embedded: boolean;
  createdAt: string;
}

/** `text` и `storagePath` — серверные поля, на клиент не уходят никогда. */
function toProjectDocumentItem(document: IProjectDocument): ProjectDocumentItem {
  return {
    fileId: document.file_id,
    title: document.title,
    filename: document.filename,
    mimetype: document.mimetype,
    bytes: document.bytes,
    tokenCount: document.tokenCount,
    embedded: document.embedded,
    createdAt: document.createdAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

export function createProjectDocumentHandlers(deps: ProjectDocumentDeps): {
  listDocuments: Handler;
  uploadDocument: Handler;
  reindexDocument: Handler;
  deleteDocument: Handler;
} {
  async function listDocuments(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id: projectId } = req.params as { id: string };
      const owner = requestUserId(req);

      const documents = await deps.listProjectDocuments(owner, projectId);
      return res.status(200).json({ documents: documents.map(toProjectDocumentItem) });
    } catch (error) {
      logger.error('[documents] listDocuments error:', error);
      return res.status(500).json({ error: 'Failed to list documents' });
    }
  }

  /**
   * Векторы уже лежат в pgvector, а записи в Mongo не будет — снять их больше некому:
   * `purgeProjectDocuments` при удалении проекта идёт по записям Mongo и такой документ
   * не найдёт. Поэтому откат обязателен именно здесь, а не при следующей уборке.
   */
  async function rollbackIndexedDocument(input: {
    fileId: string;
    entityId: string;
    owner: string;
    storagePath: string;
  }): Promise<void> {
    try {
      await deps.deleteVectors({
        fileIds: [input.fileId],
        entityId: input.entityId,
        userId: input.owner,
      });
    } catch (error) {
      logger.error('[documents] откат векторов не удался:', error);
    }
    try {
      await deps.removeOriginal(input.storagePath);
    } catch (error) {
      logger.error('[documents] откат оригинала не удался:', error);
    }
  }

  /**
   * `multer({ dest })` пишет файл на диск до входа в обработчик и сам чистит его только
   * при ошибке разбора. Отказ по квоте, скану или 502 оставлял бы 25 МБ на PVC навсегда,
   * причём квота их не считает — сотня отклонённых загрузок переполняет том.
   */
  async function removeUploadTemp(uploadPath: string | undefined): Promise<void> {
    if (!uploadPath) {
      return;
    }
    try {
      await deps.removeOriginal(uploadPath);
    } catch (error) {
      logger.warn('[documents] временный файл загрузки не удалён:', error);
    }
  }

  /**
   * Порядок операций повторяет базу знаний: оригинал сохраняется на диск раньше
   * извлечения текста и эмбеддинга, чтобы `removeOriginal` было чем откатывать
   * при их падении; запись в MongoDB создаётся только после успешного эмбеддинга.
   * Отличия от базы знаний — проверка владения проектом и квоты сотрудника.
   */
  async function uploadDocument(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { id: projectId } = req.params as { id: string };
      if (!isValidObjectIdString(projectId)) {
        return res.status(400).json({ error: 'Invalid project ID format' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'File is required' });
      }
      if (!isSupportedDocument(file.originalname, file.mimetype)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      const body = req.body as { title?: string };
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return res.status(400).json({ error: 'Document title is required' });
      }

      const owner = requestUserId(req);

      const project = await deps.getChatProject(owner, projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const [documentCount, totalBytes] = await Promise.all([
        deps.countProjectDocuments(owner, projectId),
        deps.sumProjectDocumentBytes(owner),
      ]);

      if (documentCount >= MAX_DOCUMENTS_PER_PROJECT) {
        return res.status(400).json({ error: 'Project document limit reached' });
      }
      if (totalBytes + file.size > MAX_BYTES_PER_USER) {
        return res.status(400).json({ error: 'Document storage quota exceeded' });
      }

      const fileId = randomUUID();
      const entityId = `proj_${projectId}`;

      const storagePath = await deps.saveOriginal({
        projectId,
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
          userId: owner,
        });
      } catch (error) {
        await deps.removeOriginal(storagePath);
        logger.error('[documents] extractText error:', error);
        return res.status(502).json({ error: 'Failed to extract document text' });
      }

      const textProblem = extractedTextProblem(text, file.originalname);
      if (textProblem != null) {
        await deps.removeOriginal(storagePath);
        return res
          .status(400)
          .json({ error: describeExtractedTextProblem(textProblem, file.originalname), reason: textProblem });
      }

      let embedResult: { embedded: boolean };
      try {
        embedResult = await deps.embedDocument({
          fileId,
          entityId,
          filePath: file.path,
          filename: file.originalname,
          mimetype: file.mimetype,
          text,
          userId: owner,
        });
      } catch (error) {
        await deps.removeOriginal(storagePath);
        logger.error('[documents] embedDocument error:', error);
        return res.status(502).json({ error: 'Failed to index document' });
      }

      /**
       * `rag_api` отвечает 200 и на провалившейся укладке в вектора — отличает её
       * только `status: false`. Без этой записи документ оседал в проекте молча:
       * в списке он есть, в поиске его нет, и в журнале ни строки.
       */
      if (!embedResult.embedded) {
        logger.error('[documents] документ принят, но не проиндексирован', {
          fileId,
          entityId,
          title,
          bytes: file.size,
        });
      }

      let document: IProjectDocument;
      try {
        const tokenCount = await deps.countTokens(text);
        document = await deps.createProjectDocument({
          owner,
          projectId: new Types.ObjectId(projectId),
          entityId,
          file_id: fileId,
          title,
          filename: file.originalname,
          mimetype: file.mimetype,
          bytes: file.size,
          text,
          tokenCount,
          embedded: embedResult.embedded,
          storagePath,
        });
      } catch (error) {
        await rollbackIndexedDocument({ fileId, entityId, owner, storagePath });
        logger.error('[documents] createProjectDocument error:', error);
        return res.status(500).json({ error: 'Failed to save document' });
      }

      await deps.recordUsage({
        userId: owner,
        scenario: 'doc_index',
        model: '',
        costUsd: 0,
        costSource: 'unknown',
        promptTokens: 0,
        completionTokens: 0,
      });

      return res.status(201).json({ document: toProjectDocumentItem(document) });
    } catch (error) {
      logger.error('[documents] uploadDocument error:', error);
      return res.status(500).json({ error: 'Failed to upload document' });
    } finally {
      await removeUploadTemp(req.file?.path);
    }
  }

  /**
   * Повторная попытка укладки из уже сохранённого текста: оригинал для неё не нужен,
   * а вот прежние векторы снять обязательно — после частично прошедшей укладки они
   * иначе удвоят свои фрагменты в выдаче поиска.
   */
  async function reindexDocument(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { fileId } = req.params as { fileId: string };
      const owner = requestUserId(req);

      const existing = await deps.getProjectDocument(owner, fileId);
      if (!existing) {
        return res.status(404).json({ error: 'Document not found' });
      }

      await deps.deleteVectors({
        fileIds: [existing.file_id],
        entityId: existing.entityId,
        userId: owner,
      });

      let embedResult: { embedded: boolean };
      try {
        embedResult = await deps.embedDocument({
          fileId: existing.file_id,
          entityId: existing.entityId,
          filePath: existing.storagePath,
          filename: existing.filename,
          mimetype: existing.mimetype,
          text: existing.text,
          userId: owner,
        });
      } catch (error) {
        logger.error('[documents] reindexDocument embed error:', error);
        await deps.markProjectDocumentEmbedded(owner, existing.file_id, false);
        return res.status(502).json({ error: 'Failed to index document' });
      }

      const updated = await deps.markProjectDocumentEmbedded(
        owner,
        existing.file_id,
        embedResult.embedded,
      );

      if (!embedResult.embedded) {
        logger.error('[documents] переиндексация не удалась', {
          fileId: existing.file_id,
          entityId: existing.entityId,
          title: existing.title,
        });
        return res.status(502).json({ error: 'Failed to index document' });
      }

      return res
        .status(200)
        .json({ document: toProjectDocumentItem(updated ?? { ...existing, embedded: true }) });
    } catch (error) {
      logger.error('[documents] reindexDocument error:', error);
      return res.status(500).json({ error: 'Failed to index document' });
    }
  }

  /**
   * Векторы снимаются до удаления записи в Mongo: после удаления записи `file_id`
   * и `entityId`, нужные для снятия векторов, взять уже негде, и они остаются в
   * pgvector навсегда. Поэтому документ сначала читается через `getProjectDocument`
   * без удаления, и только потом идёт `deleteVectors`, а `deleteProjectDocument`
   * остаётся единственной точкой, подтверждающей владение документом.
   */
  async function deleteDocument(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { fileId } = req.params as { fileId: string };
      const owner = requestUserId(req);

      const existing = await deps.getProjectDocument(owner, fileId);
      if (existing) {
        await deps.deleteVectors({
          fileIds: [existing.file_id],
          entityId: existing.entityId,
          userId: owner,
        });
      }

      const deleted = await deps.deleteProjectDocument(owner, fileId);
      if (!deleted) {
        return res.status(404).json({ error: 'Document not found' });
      }

      await deps.removeOriginal(deleted.storagePath);

      return res.status(200).json({ success: true });
    } catch (error) {
      logger.error('[documents] deleteDocument error:', error);
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  }

  return { listDocuments, uploadDocument, reindexDocument, deleteDocument };
}
