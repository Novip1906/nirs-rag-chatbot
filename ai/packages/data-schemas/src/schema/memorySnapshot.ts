import { Schema } from 'mongoose';
import type { IMemorySnapshot } from '~/types/memory';

const MEMORY_SNAPSHOT_TTL_SECONDS: number = 30 * 24 * 60 * 60;

const memorySnapshotEntrySchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: String, default: '' },
    title: { type: String },
    tokenCount: { type: Number, default: 0 },
    updated_at: { type: Date, required: true },
  },
  { _id: false },
);

const memorySnapshotSchema: Schema<IMemorySnapshot> = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true,
  },
  agentId: {
    type: String,
    default: null,
  },
  chatProjectId: {
    type: String,
    default: null,
  },
  entries: {
    type: [memorySnapshotEntrySchema],
    default: [],
  },
  reason: {
    type: String,
    enum: ['manual', 'auto'],
    required: true,
  },
  before: {
    type: Number,
    required: true,
  },
  after: {
    type: Number,
    default: null,
  },
  appliedAt: {
    type: Date,
    default: null,
  },
  compactedIds: {
    type: [String],
    default: undefined,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  tenantId: {
    type: String,
    index: true,
  },
});

memorySnapshotSchema.index({ userId: 1, createdAt: -1 });
memorySnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: MEMORY_SNAPSHOT_TTL_SECONDS });

export default memorySnapshotSchema;
