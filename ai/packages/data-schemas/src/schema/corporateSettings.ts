import { Schema } from 'mongoose';
import type { ICorporateSettings } from '~/types';
import { limitsFields, limitsDefaults } from '~/schema/department';

const corporateSettingsSchema: Schema<ICorporateSettings> = new Schema<ICorporateSettings>(
  {
    key: { type: String, enum: ['global'], default: 'global', unique: true },
    systemPrompt: { type: String, default: '' },
    allowedModels: { type: [String], default: [] },
    defaultModel: { type: String, default: null },
    defaultLimits: {
      type: new Schema(limitsFields, { _id: false }),
      default: () => ({ ...limitsDefaults }),
    },
    /** Keyed by provider model id. `Mixed`, not a sub-schema: keys are arbitrary
     *  model ids from the provider catalog, not a fixed field set. */
    modelCapabilities: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export default corporateSettingsSchema;
