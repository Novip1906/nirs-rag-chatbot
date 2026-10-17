import { Schema } from 'mongoose';
import type { IProjectDocument } from '~/types';

const projectDocumentSchema: Schema<IProjectDocument> = new Schema<IProjectDocument>(
  {
    owner: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'ChatProject', required: true, index: true },
    entityId: { type: String, required: true, index: true },
    file_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    filename: { type: String, default: '' },
    mimetype: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    text: { type: String, default: '' },
    tokenCount: { type: Number, default: 0 },
    embedded: { type: Boolean, default: false },
    storagePath: { type: String, default: '' },
    status: { type: String, enum: ['active', 'deleted'], default: 'active', index: true },
  },
  { timestamps: true },
);

projectDocumentSchema.index({ owner: 1, projectId: 1, status: 1 });

/**
 * Отдельная коллекция от `knowledgeDocument` нужна именно из-за этого индекса:
 * MongoDB допускает не более одного текстового индекса на коллекцию, а лексическая
 * ветка поиска требуется и корпоративной базе, и документам сотрудника.
 */
projectDocumentSchema.index(
  { title: 'text', text: 'text' },
  { default_language: 'russian', weights: { title: 3, text: 1 }, name: 'project_document_text_ru' },
);

export default projectDocumentSchema;
