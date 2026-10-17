import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type * as t from '~/types';
import logger from '~/config/winston';

export interface MemorySnapshotMethods {
  createMemorySnapshot: (params: t.CreateMemorySnapshotParams) => Promise<{ id: string }>;
  completeMemorySnapshot: (params: t.CompleteMemorySnapshotParams) => Promise<void>;
  getMemorySnapshot: (params: t.GetMemorySnapshotParams) => Promise<t.IMemorySnapshotLean | null>;
  getRecentMemorySnapshots: (
    params: t.GetRecentMemorySnapshotsParams,
  ) => Promise<t.RecentMemorySnapshot[]>;
  deleteMemorySnapshot: (params: t.DeleteMemorySnapshotParams) => Promise<void>;
}

export function createMemorySnapshotMethods(
  mongoose: typeof import('mongoose'),
): MemorySnapshotMethods {
  async function createMemorySnapshot({
    userId,
    agentId,
    chatProjectId,
    entries,
    reason,
  }: t.CreateMemorySnapshotParams): Promise<{ id: string }> {
    try {
      const MemorySnapshot = mongoose.models.MemorySnapshot as Model<t.IMemorySnapshot>;
      const snapshot = await MemorySnapshot.create({
        userId,
        agentId: agentId ?? null,
        chatProjectId: chatProjectId ?? null,
        entries,
        reason,
        before: entries.length,
        after: null,
      });
      return { id: snapshot._id.toString() };
    } catch (error) {
      throw new Error(
        `Failed to create memory snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async function completeMemorySnapshot({
    userId,
    snapshotId,
    after,
    appliedAt,
    compactedIds,
  }: t.CompleteMemorySnapshotParams): Promise<void> {
    if (!Types.ObjectId.isValid(snapshotId)) {
      return;
    }
    try {
      const MemorySnapshot = mongoose.models.MemorySnapshot as Model<t.IMemorySnapshot>;
      const completed = await MemorySnapshot.findOneAndUpdate(
        { _id: snapshotId, userId },
        { $set: { after, appliedAt, compactedIds } },
        { new: true },
      ).lean<t.IMemorySnapshotLean>();
      if (completed == null) {
        return;
      }
      await MemorySnapshot.deleteMany({
        userId,
        agentId: completed.agentId ?? null,
        chatProjectId: completed.chatProjectId ?? null,
        _id: { $ne: completed._id },
        createdAt: { $lte: completed.createdAt },
      });
    } catch (error) {
      logger.error('[completeMemorySnapshot] Error completing memory snapshot', error);
      throw new Error('Error completing memory snapshot');
    }
  }

  async function getMemorySnapshot({
    userId,
    snapshotId,
  }: t.GetMemorySnapshotParams): Promise<t.IMemorySnapshotLean | null> {
    if (!Types.ObjectId.isValid(snapshotId)) {
      return null;
    }
    try {
      const MemorySnapshot = mongoose.models.MemorySnapshot as Model<t.IMemorySnapshot>;
      return await MemorySnapshot.findOne({
        _id: snapshotId,
        userId,
      }).lean<t.IMemorySnapshotLean>();
    } catch (error) {
      logger.error('[getMemorySnapshot] Error getting memory snapshot', error);
      throw new Error('Error getting memory snapshot');
    }
  }

  async function getRecentMemorySnapshots({
    userId,
    since,
  }: t.GetRecentMemorySnapshotsParams): Promise<t.RecentMemorySnapshot[]> {
    try {
      const MemorySnapshot = mongoose.models.MemorySnapshot as Model<t.IMemorySnapshot>;
      const snapshots = await MemorySnapshot.find({
        userId,
        createdAt: { $gte: since },
        after: { $ne: null },
      })
        .select({ entries: 0, compactedIds: 0 })
        .sort({ createdAt: -1 })
        .lean<Omit<t.IMemorySnapshotLean, 'entries'>[]>();
      return snapshots.map((snapshot) => ({
        snapshotId: snapshot._id.toString(),
        agentId: snapshot.agentId ?? null,
        chatProjectId: snapshot.chatProjectId ?? null,
        before: snapshot.before,
        after: snapshot.after as number,
        reason: snapshot.reason,
        createdAt: snapshot.createdAt,
      }));
    } catch (error) {
      logger.error('[getRecentMemorySnapshots] Error listing memory snapshots', error);
      throw new Error('Error listing memory snapshots');
    }
  }

  async function deleteMemorySnapshot({
    userId,
    snapshotId,
  }: t.DeleteMemorySnapshotParams): Promise<void> {
    if (!Types.ObjectId.isValid(snapshotId)) {
      return;
    }
    try {
      const MemorySnapshot = mongoose.models.MemorySnapshot as Model<t.IMemorySnapshot>;
      await MemorySnapshot.deleteOne({ _id: snapshotId, userId });
    } catch (error) {
      logger.error('[deleteMemorySnapshot] Error deleting memory snapshot', error);
      throw new Error('Error deleting memory snapshot');
    }
  }

  return {
    createMemorySnapshot,
    completeMemorySnapshot,
    getMemorySnapshot,
    getRecentMemorySnapshots,
    deleteMemorySnapshot,
  };
}
