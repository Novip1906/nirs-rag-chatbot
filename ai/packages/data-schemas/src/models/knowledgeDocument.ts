import { Model } from 'mongoose';
import type * as t from '~/types';
import knowledgeDocumentSchema from '~/schema/knowledgeDocument';

export function createKnowledgeDocumentModel(
  mongoose: typeof import('mongoose'),
): Model<t.IKnowledgeDocument> {
  return (
    mongoose.models.KnowledgeDocument ||
    mongoose.model<t.IKnowledgeDocument>('KnowledgeDocument', knowledgeDocumentSchema)
  );
}
