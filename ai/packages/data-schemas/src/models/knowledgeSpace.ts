import { Model } from 'mongoose';
import type * as t from '~/types';
import knowledgeSpaceSchema from '~/schema/knowledgeSpace';

export function createKnowledgeSpaceModel(
  mongoose: typeof import('mongoose'),
): Model<t.IKnowledgeSpace> {
  return (
    mongoose.models.KnowledgeSpace ||
    mongoose.model<t.IKnowledgeSpace>('KnowledgeSpace', knowledgeSpaceSchema)
  );
}
