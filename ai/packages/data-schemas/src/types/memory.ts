import type { Types, Document } from 'mongoose';

// Base memory interfaces
export interface IMemoryEntry extends Document {
  userId: Types.ObjectId;
  key: string;
  value: string;
  title?: string;
  /** Agent partition; null/absent = shared personal pool */
  agentId?: string;
  /** Chat project partition; null/absent = shared personal pool */
  chatProjectId?: string;
  tokenCount?: number;
  updated_at?: Date;
  tenantId?: string;
}

export interface IMemoryEntryLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  value: string;
  title?: string;
  agentId?: string;
  chatProjectId?: string;
  tokenCount?: number;
  updated_at?: Date;
  __v?: number;
}

// Method parameter interfaces
export interface SetMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  value: string;
  title?: string;
  tokenCount?: number;
  /** Agent partition; omit for the shared personal pool */
  agentId?: string;
  /** Chat project partition; omit for the shared personal pool */
  chatProjectId?: string;
}

export interface CreateMemoryParams {
  userId: string | Types.ObjectId;
  key?: string;
  value: string;
  title?: string;
  tokenCount?: number;
  agentId?: string;
  chatProjectId?: string;
}

export interface DeleteMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  agentId?: string;
  chatProjectId?: string;
}

export interface MemoryByIdParams {
  userId: string | Types.ObjectId;
  id: string;
  agentId?: string;
  chatProjectId?: string;
}

export interface SetMemoryByIdParams extends MemoryByIdParams {
  /** Omit to preserve the existing key. */
  key?: string;
  value: string;
  title?: string;
  tokenCount?: number;
}

export interface GetUserMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
  chatProjectId?: string;
}

export interface GetFormattedMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
  chatProjectId?: string;
}

// Result interfaces
export interface MemoryResult {
  ok: boolean;
  /** Why a write was refused, so callers can answer with the right status instead of
   *  reporting every refusal as a server error. Absent when `ok` is true. */
  reason?: 'invalid_key' | 'invalid_project';
  key?: string;
  title?: string;
  created?: boolean;
  previous?: { value: string; title?: string; tokenCount?: number } | null;
}

export interface RevertMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  agentId?: string;
  chatProjectId?: string;
  expectedValue: string;
  previous: { value: string; title?: string; tokenCount: number } | null;
}

export interface RevertMemoryResult {
  ok: boolean;
  reason?: 'changed' | 'not_found' | 'invalid_project';
}

export interface ReplacePartitionMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
  chatProjectId?: string;
  expected: Array<{ _id: string | Types.ObjectId; updated_at?: Date | null }>;
  entries: Array<{ key: string; value: string; title?: string; tokenCount: number }>;
}

export type ReplacePartitionMemoriesResult =
  | { ok: true; insertedIds: string[]; appliedAt: Date }
  | { ok: false; reason: 'changed' };

export interface RestorePartitionMemoriesParams {
  userId: string | Types.ObjectId;
  agentId?: string;
  chatProjectId?: string;
  compactedIds: string[];
  appliedAt: Date | null;
  entries: IMemorySnapshotEntry[];
}

export interface RestorePartitionMemoriesResult {
  restored: number;
}

export interface SetMemoryByIdResult extends MemoryResult {
  conflict?: boolean;
  memory?: IMemoryEntryLean;
}

export interface FormattedMemoriesResult {
  withKeys: string;
  withoutKeys: string;
  totalTokens?: number;
}

export interface IMemorySnapshotEntry {
  key: string;
  value: string;
  title?: string;
  tokenCount: number;
  updated_at: Date;
}

export interface IMemorySnapshot extends Document {
  userId: Types.ObjectId;
  agentId?: string | null;
  chatProjectId?: string | null;
  entries: IMemorySnapshotEntry[];
  reason: 'manual' | 'auto';
  before: number;
  after?: number | null;
  appliedAt?: Date | null;
  compactedIds?: string[];
  createdAt: Date;
  tenantId?: string;
}

export interface IMemorySnapshotLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  agentId?: string | null;
  chatProjectId?: string | null;
  entries: IMemorySnapshotEntry[];
  reason: 'manual' | 'auto';
  before: number;
  after?: number | null;
  appliedAt?: Date | null;
  compactedIds?: string[];
  createdAt: Date;
}

export interface CreateMemorySnapshotParams {
  userId: string | Types.ObjectId;
  agentId?: string;
  chatProjectId?: string;
  entries: IMemorySnapshotEntry[];
  reason: 'manual' | 'auto';
}

export interface CompleteMemorySnapshotParams {
  userId: string | Types.ObjectId;
  snapshotId: string;
  after: number;
  appliedAt: Date;
  compactedIds: string[];
}

export interface GetMemorySnapshotParams {
  userId: string | Types.ObjectId;
  snapshotId: string;
}

export interface GetRecentMemorySnapshotsParams {
  userId: string | Types.ObjectId;
  since: Date;
}

export interface RecentMemorySnapshot {
  snapshotId: string;
  agentId?: string | null;
  chatProjectId?: string | null;
  before: number;
  after: number;
  reason: 'manual' | 'auto';
  createdAt: Date;
}

export interface DeleteMemorySnapshotParams {
  userId: string | Types.ObjectId;
  snapshotId: string;
}
