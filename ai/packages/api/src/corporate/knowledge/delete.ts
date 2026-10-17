import { KnowledgeSpaceNotEmptyError, logger } from '@librechat/data-schemas';
import type { IKnowledgeDocument } from '@librechat/data-schemas';

export interface DeleteVectorsInput {
  fileIds: string[];
  entityId: string;
  userId: string;
}

export interface DeleteDocumentDeps {
  deleteVectors: (input: DeleteVectorsInput) => Promise<void>;
  deleteDocument: (id: string) => Promise<boolean>;
  removeOriginal: (storagePath: string) => Promise<void>;
}

export type DeleteDocumentOutcome = { ok: true } | { ok: false; error: 'vectors' };

/**
 * Общий порядок безвозвратного удаления документа — единственное место, где он
 * записан: и админский роутер, и роутер сотрудника (глава отдела) обязаны звать
 * именно это, а не повторять порядок операций у себя. Обратный порядок оставил
 * бы висящие векторы — после удаления записи в MongoDB `file_id` потерян, и снять
 * их из pgvector нечем, они продолжали бы попадать в выдачу поиска. Поэтому
 * векторы снимаются первыми; если это не удалось, ни запись в MongoDB, ни
 * оригинал на диске/в объектном хранилище не трогаются.
 */
export async function deleteDocumentPermanently(
  deps: DeleteDocumentDeps,
  document: Pick<IKnowledgeDocument, '_id' | 'file_id' | 'spaceId' | 'storagePath'>,
  userId: string,
): Promise<DeleteDocumentOutcome> {
  try {
    await deps.deleteVectors({
      fileIds: [document.file_id],
      entityId: document.spaceId.toString(),
      userId,
    });
  } catch (error) {
    logger.error('[knowledge] deleteVectors error:', error);
    return { ok: false, error: 'vectors' };
  }

  await deps.deleteDocument(document._id.toString());
  if (document.storagePath) {
    await deps.removeOriginal(document.storagePath);
  }

  return { ok: true };
}

/**
 * Непустое пространство `db.deleteSpace` отклоняет своей ошибкой
 * (`KnowledgeSpaceNotEmptyError`), несущей число документов полем: обработчики
 * отдают его клиенту, который строит собственную локализованную формулировку.
 * Разбирать текст сообщения не нужно — и не следует, иначе формулировка станет
 * контрактом между слоями.
 */
export function isDeleteSpaceConflict(error: unknown): error is KnowledgeSpaceNotEmptyError {
  return error instanceof KnowledgeSpaceNotEmptyError;
}

/** Число включает архивные документы: `deleteSpace` считает их наравне с активными. */
export function deleteSpaceConflictCount(error: unknown): number | undefined {
  return isDeleteSpaceConflict(error) ? error.documentCount : undefined;
}
