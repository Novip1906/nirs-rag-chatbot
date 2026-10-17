import type { Model } from 'mongoose';
import type { IProjectDocument } from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';

export type CreateProjectDocumentInput = Omit<
  IProjectDocument,
  '_id' | 'createdAt' | 'updatedAt' | 'status'
>;

export interface ProjectDocumentMethods {
  createProjectDocument(input: CreateProjectDocumentInput): Promise<IProjectDocument>;
  markProjectDocumentEmbedded(
    owner: string,
    fileId: string,
    embedded: boolean,
  ): Promise<IProjectDocument | null>;
  listProjectDocuments(owner: string, projectId: string): Promise<IProjectDocument[]>;
  getProjectDocument(owner: string, fileId: string): Promise<IProjectDocument | null>;
  deleteProjectDocument(owner: string, fileId: string): Promise<IProjectDocument | null>;
  listProjectDocumentsByProject(projectId: string): Promise<IProjectDocument[]>;
  countProjectDocuments(owner: string, projectId: string): Promise<number>;
  sumProjectDocumentBytes(owner: string): Promise<number>;
  lexicalSearchProjectDocuments(input: {
    fileIds: string[];
    query: string;
    limit: number;
  }): Promise<string[]>;
}

export function createProjectDocumentMethods(
  mongoose: typeof import('mongoose'),
): ProjectDocumentMethods {
  const model = () => mongoose.models.ProjectDocument as Model<IProjectDocument>;

  async function createProjectDocument(
    input: CreateProjectDocumentInput,
  ): Promise<IProjectDocument> {
    return model().create(input);
  }

  async function markProjectDocumentEmbedded(
    owner: string,
    fileId: string,
    embedded: boolean,
  ): Promise<IProjectDocument | null> {
    return model()
      .findOneAndUpdate(
        { owner, file_id: fileId, status: 'active' },
        { $set: { embedded } },
        { new: true },
      )
      .lean<IProjectDocument>();
  }

  async function listProjectDocuments(
    owner: string,
    projectId: string,
  ): Promise<IProjectDocument[]> {
    if (!isValidObjectIdString(projectId)) {
      return [];
    }
    return model()
      .find({ owner, projectId: new mongoose.Types.ObjectId(projectId), status: 'active' })
      .sort({ createdAt: 1 })
      .lean<IProjectDocument[]>();
  }

  async function getProjectDocument(
    owner: string,
    fileId: string,
  ): Promise<IProjectDocument | null> {
    return model().findOne({ owner, file_id: fileId, status: 'active' }).lean<IProjectDocument>();
  }

  /**
   * Возвращает документ до удаления: вызывающая сторона снимает по нему векторы
   * в rag_api, а после удаления записи `file_id` и `entityId` взять уже негде.
   */
  async function deleteProjectDocument(
    owner: string,
    fileId: string,
  ): Promise<IProjectDocument | null> {
    return model().findOneAndDelete({ owner, file_id: fileId }).lean<IProjectDocument>();
  }

  async function listProjectDocumentsByProject(projectId: string): Promise<IProjectDocument[]> {
    if (!isValidObjectIdString(projectId)) {
      return [];
    }
    return model()
      .find({ projectId: new mongoose.Types.ObjectId(projectId) })
      .lean<IProjectDocument[]>();
  }

  async function countProjectDocuments(owner: string, projectId: string): Promise<number> {
    if (!isValidObjectIdString(projectId)) {
      return 0;
    }
    return model().countDocuments({
      owner,
      projectId: new mongoose.Types.ObjectId(projectId),
      status: 'active',
    });
  }

  async function sumProjectDocumentBytes(owner: string): Promise<number> {
    const [result] = await model().aggregate<{ total: number }>([
      { $match: { owner, status: 'active' } },
      { $group: { _id: null, total: { $sum: '$bytes' } } },
    ]);
    return result?.total ?? 0;
  }

  /**
   * Список `fileIds` — не оптимизация, а проверка прав: он собран из документов,
   * которые вызывающая сторона уже признала доступными. Поиск обязан оставаться
   * внутри него, иначе текстовый индекс выдаст чужие документы.
   */
  async function lexicalSearchProjectDocuments(input: {
    fileIds: string[];
    query: string;
    limit: number;
  }): Promise<string[]> {
    if (input.fileIds.length === 0 || input.query.trim() === '') {
      return [];
    }
    const rows = await model()
      .find(
        { file_id: { $in: input.fileIds }, $text: { $search: input.query } },
        { file_id: 1, score: { $meta: 'textScore' } },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(input.limit)
      .lean<Array<{ file_id: string }>>();
    return rows.map((row) => row.file_id);
  }

  return {
    createProjectDocument,
    markProjectDocumentEmbedded,
    listProjectDocuments,
    getProjectDocument,
    deleteProjectDocument,
    listProjectDocumentsByProject,
    countProjectDocuments,
    sumProjectDocumentBytes,
    lexicalSearchProjectDocuments,
  };
}
