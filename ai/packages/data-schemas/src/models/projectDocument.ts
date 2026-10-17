import { Model } from 'mongoose';
import type * as t from '~/types';
import projectDocumentSchema from '~/schema/projectDocument';

export function createProjectDocumentModel(
  mongoose: typeof import('mongoose'),
): Model<t.IProjectDocument> {
  return (
    mongoose.models.ProjectDocument ||
    mongoose.model<t.IProjectDocument>('ProjectDocument', projectDocumentSchema)
  );
}
