import { Schema } from 'mongoose';
import type { IUserPolicy } from '~/types';
import { limitsFields } from '~/schema/department';

const userPolicySchema: Schema<IUserPolicy> = new Schema<IUserPolicy>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    limits: { type: new Schema(limitsFields, { _id: false }), default: null },
    allowedModels: { type: [String], default: null },
    defaultModel: { type: String, default: null },
    blocked: { type: Boolean, default: false },
    allowedSpaces: { type: [Schema.Types.ObjectId], ref: 'KnowledgeSpace', default: [] },
    deniedSpaces: { type: [Schema.Types.ObjectId], ref: 'KnowledgeSpace', default: [] },
    canUploadKnowledge: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default userPolicySchema;
