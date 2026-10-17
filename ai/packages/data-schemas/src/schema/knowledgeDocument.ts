import { Schema } from 'mongoose';
import type { IKnowledgeDocument } from '~/types';

const knowledgeDocumentSchema: Schema<IKnowledgeDocument> = new Schema<IKnowledgeDocument>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'KnowledgeSpace', required: true, index: true },
    file_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    filename: { type: String, default: '' },
    source: { type: String, default: '' },
    owner: { type: String, default: '' },
    version: { type: String, default: '' },
    effectiveDate: { type: Date, default: null },
    status: { type: String, enum: ['active', 'archived', 'draft'], default: 'active', index: true },
    supersedesId: { type: Schema.Types.ObjectId, ref: 'KnowledgeDocument', default: null },
    embeddingModel: { type: String, default: '' },
    storagePath: { type: String, default: '' },
    text: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    mimetype: { type: String, default: '' },
    embedded: { type: Boolean, default: false },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

knowledgeDocumentSchema.index({ spaceId: 1, status: 1 });
/**
 * MongoDB допускает не более одного текстового индекса на коллекцию, поэтому
 * название и тело документа объединены в один индекс; совпадение с названием
 * почти всегда важнее совпадения где-то в теле, отсюда больший вес `title`.
 */
knowledgeDocumentSchema.index(
  { title: 'text', text: 'text' },
  { default_language: 'russian', weights: { title: 3, text: 1 }, name: 'knowledge_text_ru' },
);

export default knowledgeDocumentSchema;
