import type { IProjectDocument } from '@librechat/data-schemas';

export interface ProjectDocumentCleanupRecord {
  file_id: string;
  entityId: string;
  storagePath: string;
}

export interface ProjectDocumentCleanupDeps {
  listProjectDocumentsByProject: (projectId: string) => Promise<ProjectDocumentCleanupRecord[]>;
  deleteVectors: (input: { fileIds: string[]; entityId: string; userId: string }) => Promise<void>;
  deleteProjectDocument: (owner: string, fileId: string) => Promise<IProjectDocument | null>;
  removeOriginal: (storagePath: string) => Promise<void>;
}

export interface PurgeProjectDocumentsInput {
  owner: string;
  projectId: string;
}

export interface PurgeProjectDocumentsResult {
  removed: number;
}

/**
 * Порядок строгий: векторы всех документов проекта снимаются одним запросом
 * (они живут в одном разделе rag_api), и только после этого удаляются записи
 * в Mongo и оригиналы с диска. Если снятие векторов упадёт, записи останутся
 * нетронутыми — иначе `file_id` для повторной попытки будет уже потерян.
 */
export async function purgeProjectDocuments(
  deps: ProjectDocumentCleanupDeps,
  input: PurgeProjectDocumentsInput,
): Promise<PurgeProjectDocumentsResult> {
  const documents = await deps.listProjectDocumentsByProject(input.projectId);
  if (documents.length === 0) {
    return { removed: 0 };
  }

  const entityId = documents[0].entityId;
  await deps.deleteVectors({
    fileIds: documents.map((document) => document.file_id),
    entityId,
    userId: input.owner,
  });

  for (const document of documents) {
    await deps.deleteProjectDocument(input.owner, document.file_id);
  }
  for (const document of documents) {
    await deps.removeOriginal(document.storagePath);
  }

  return { removed: documents.length };
}
