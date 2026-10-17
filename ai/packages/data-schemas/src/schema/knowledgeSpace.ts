import { Schema } from 'mongoose';
import type { IKnowledgeSpace } from '~/types';

const knowledgeSpaceSchema: Schema<IKnowledgeSpace> = new Schema<IKnowledgeSpace>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '' },
    allowedDepartments: { type: [Schema.Types.ObjectId], ref: 'Department', default: [] },
    embeddingModel: { type: String, default: 'baai/bge-m3' },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default knowledgeSpaceSchema;
