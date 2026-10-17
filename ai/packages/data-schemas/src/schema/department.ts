import { Schema } from 'mongoose';
import type { IDepartment } from '~/types';

const limitsDefaults = {
  dailyCostUsd: null,
};

interface LimitField {
  type: NumberConstructor;
  default: null;
}

const limitsFields: Record<keyof typeof limitsDefaults, LimitField> = {
  dailyCostUsd: { type: Number, default: null },
};

const departmentSchema: Schema<IDepartment> = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String },
    systemPrompt: { type: String, default: '' },
    allowedModels: { type: [String], default: [] },
    defaultModel: { type: String, default: null },
    defaultLimits: {
      type: new Schema(limitsFields, { _id: false }),
      default: () => ({ ...limitsDefaults }),
    },
    directoryId: { type: String },
  },
  { timestamps: true },
);

departmentSchema.index(
  { directoryId: 1 },
  { unique: true, partialFilterExpression: { directoryId: { $type: 'string' } } },
);

export { limitsFields, limitsDefaults };
export default departmentSchema;
