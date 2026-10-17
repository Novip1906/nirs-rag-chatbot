import { Schema } from 'mongoose';
import type { IUsageRecord } from '~/types';

const usageRecordSchema: Schema<IUsageRecord> = new Schema<IUsageRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    model: { type: String, required: true },
    conversationId: { type: String },
    messageId: { type: String },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    costSource: { type: String, enum: ['provider', 'estimate', 'unknown'], default: 'unknown' },
    scenario: { type: String, default: '' },
    imagePrompt: { type: String },
    imageFileId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

usageRecordSchema.index({ userId: 1, createdAt: -1 });
usageRecordSchema.index({ departmentId: 1, createdAt: -1 });
usageRecordSchema.index({ model: 1, createdAt: -1 });
usageRecordSchema.index({ createdAt: -1 });

export default usageRecordSchema;
