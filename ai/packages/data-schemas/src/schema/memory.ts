import { Schema } from 'mongoose';
import type { IMemoryEntry } from '~/types/memory';

/**
 * Shape a memory key must have. Exported because the write methods enforce it before
 * hitting the database: `setMemory` upserts through `findOneAndUpdate`, where the key
 * comes from the filter rather than the update and this validator never runs.
 */
export const MEMORY_KEY_PATTERN: RegExp = /^[a-z_]+$/;

const MemoryEntrySchema: Schema<IMemoryEntry> = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true,
  },
  key: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => MEMORY_KEY_PATTERN.test(v),
      message: 'Key must only contain lowercase letters and underscores',
    },
  },
  value: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    required: false,
  },
  /** Agent partition; null/absent = shared personal pool */
  agentId: {
    type: String,
    default: undefined,
  },
  /** Chat project partition; null/absent = shared personal pool */
  chatProjectId: {
    type: String,
    default: undefined,
  },
  tokenCount: {
    type: Number,
    default: 0,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
  tenantId: {
    type: String,
    index: true,
  },
});

MemoryEntrySchema.index({ userId: 1, agentId: 1, key: 1 });
MemoryEntrySchema.index({ userId: 1, chatProjectId: 1, key: 1 });

export default MemoryEntrySchema;
