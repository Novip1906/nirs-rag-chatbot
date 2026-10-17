import type { Model } from 'mongoose';
import type { IKnowledgeDocument, IKnowledgeSpace, KnowledgeStatus } from '~/types';

/**
 * Число документов едет отдельным полем, а не только в тексте: обработчики отдают
 * его клиенту, который строит собственную локализованную формулировку. Вытаскивать
 * его регуляркой из сообщения значило бы сделать текст ошибки контрактом между
 * слоями. Счёт ведётся без фильтра по статусу — архивные документы держат
 * пространство так же, как активные.
 */
export class KnowledgeSpaceNotEmptyError extends Error {
  readonly documentCount: number;

  constructor(documentCount: number) {
    super(`Нельзя удалить пространство: в нём ${documentCount} документ(ов)`);
    this.name = 'KnowledgeSpaceNotEmptyError';
    this.documentCount = documentCount;
  }
}

export interface CreateSpaceInput {
  name: string;
  description?: string;
  allowedDepartments?: string[];
  embeddingModel?: string;
  enabled?: boolean;
}

export type UpdateSpaceInput = Partial<CreateSpaceInput>;

export interface CreateDocumentInput {
  spaceId: string;
  file_id: string;
  title: string;
  description?: string;
  filename?: string;
  source?: string;
  owner?: string;
  version?: string;
  effectiveDate?: Date | null;
  status?: KnowledgeStatus;
  supersedesId?: string | null;
  embeddingModel?: string;
  storagePath?: string;
  text?: string;
  bytes?: number;
  mimetype?: string;
  embedded?: boolean;
  uploadedBy: string;
}

export type UpdateDocumentInput = Partial<
  Omit<CreateDocumentInput, 'spaceId' | 'file_id' | 'uploadedBy'>
>;

export interface ListDocumentsFilter {
  spaceId: string;
  status?: KnowledgeStatus;
}

export interface LexicalSearchInput {
  fileIds: string[];
  query: string;
  limit: number;
}

interface LexicalSearchRow {
  file_id: string;
}

export interface KnowledgeMethods {
  listSpaces: () => Promise<IKnowledgeSpace[]>;
  getSpaceById: (id: string) => Promise<IKnowledgeSpace | null>;
  createSpace: (fields: CreateSpaceInput) => Promise<IKnowledgeSpace>;
  updateSpace: (id: string, fields: UpdateSpaceInput) => Promise<IKnowledgeSpace | null>;
  deleteSpace: (id: string) => Promise<boolean>;
  countDocumentsBySpace: () => Promise<Map<string, number>>;
  listDocuments: (filter: ListDocumentsFilter) => Promise<IKnowledgeDocument[]>;
  getDocumentById: (id: string) => Promise<IKnowledgeDocument | null>;
  findDocumentByFileId: (fileId: string) => Promise<IKnowledgeDocument | null>;
  findActiveDocuments: (spaceIds: string[]) => Promise<IKnowledgeDocument[]>;
  createDocument: (fields: CreateDocumentInput) => Promise<IKnowledgeDocument>;
  updateDocument: (id: string, fields: UpdateDocumentInput) => Promise<IKnowledgeDocument | null>;
  deleteDocument: (id: string) => Promise<boolean>;
  archiveDocument: (id: string) => Promise<IKnowledgeDocument | null>;
  lexicalSearch: (input: LexicalSearchInput) => Promise<string[]>;
}

export function createKnowledgeMethods(mongoose: typeof import('mongoose')): KnowledgeMethods {
  const spaceModel = () => mongoose.models.KnowledgeSpace as Model<IKnowledgeSpace>;
  const documentModel = () => mongoose.models.KnowledgeDocument as Model<IKnowledgeDocument>;

  async function listSpaces(): Promise<IKnowledgeSpace[]> {
    return spaceModel().find({}).sort({ name: 1 });
  }

  async function getSpaceById(id: string): Promise<IKnowledgeSpace | null> {
    return spaceModel().findById(id);
  }

  async function createSpace(fields: CreateSpaceInput): Promise<IKnowledgeSpace> {
    return spaceModel().create(fields);
  }

  async function updateSpace(
    id: string,
    fields: UpdateSpaceInput,
  ): Promise<IKnowledgeSpace | null> {
    return spaceModel().findByIdAndUpdate(id, { $set: fields }, { new: true });
  }

  /**
   * Осиротевшие в pgvector векторы после удаления пространства не найти и не
   * снять — поэтому удаление непустого пространства запрещено на уровне метода,
   * а не только в обработчике админки.
   */
  async function deleteSpace(id: string): Promise<boolean> {
    const count = await documentModel().countDocuments({ spaceId: id });
    if (count > 0) {
      throw new KnowledgeSpaceNotEmptyError(count);
    }
    const deleted = await spaceModel().findByIdAndDelete(id);
    return deleted != null;
  }

  async function countDocumentsBySpace(): Promise<Map<string, number>> {
    const rows = await documentModel().aggregate<{ _id: unknown; count: number }>([
      { $group: { _id: '$spaceId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  async function listDocuments(filter: ListDocumentsFilter): Promise<IKnowledgeDocument[]> {
    const query: { spaceId: string; status?: KnowledgeStatus } = { spaceId: filter.spaceId };
    if (filter.status !== undefined) {
      query.status = filter.status;
    }
    return documentModel().find(query).sort({ createdAt: -1 });
  }

  async function getDocumentById(id: string): Promise<IKnowledgeDocument | null> {
    return documentModel().findById(id);
  }

  /** Статус документа значения не имеет: ссылка на архивный документ должна открываться так же, как на активный. */
  async function findDocumentByFileId(fileId: string): Promise<IKnowledgeDocument | null> {
    return documentModel().findOne({ file_id: fileId });
  }

  async function findActiveDocuments(spaceIds: string[]): Promise<IKnowledgeDocument[]> {
    if (spaceIds.length === 0) {
      return [];
    }
    return documentModel().find({ spaceId: { $in: spaceIds }, status: 'active' });
  }

  async function createDocument(fields: CreateDocumentInput): Promise<IKnowledgeDocument> {
    return documentModel().create(fields);
  }

  async function updateDocument(
    id: string,
    fields: UpdateDocumentInput,
  ): Promise<IKnowledgeDocument | null> {
    return documentModel().findByIdAndUpdate(id, { $set: fields }, { new: true });
  }

  async function deleteDocument(id: string): Promise<boolean> {
    const deleted = await documentModel().findByIdAndDelete(id);
    return deleted != null;
  }

  async function archiveDocument(id: string): Promise<IKnowledgeDocument | null> {
    return documentModel().findByIdAndUpdate(id, { $set: { status: 'archived' } }, { new: true });
  }

  async function lexicalSearch({ fileIds, query, limit }: LexicalSearchInput): Promise<string[]> {
    if (fileIds.length === 0 || query.trim() === '') {
      return [];
    }
    const rows = await documentModel()
      .find(
        { file_id: { $in: fileIds }, $text: { $search: query } },
        { file_id: 1, score: { $meta: 'textScore' } },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean<LexicalSearchRow[]>();
    return rows.map((row) => row.file_id);
  }

  return {
    listSpaces,
    getSpaceById,
    createSpace,
    updateSpace,
    deleteSpace,
    countDocumentsBySpace,
    listDocuments,
    getDocumentById,
    findDocumentByFileId,
    findActiveDocuments,
    createDocument,
    updateDocument,
    deleteDocument,
    archiveDocument,
    lexicalSearch,
  };
}
