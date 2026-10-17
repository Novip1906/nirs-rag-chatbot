import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type * as t from '~/types';
import { normalizeMemoryTitle, resolveMemoryKey } from '~/utils/memory';
import { isValidObjectIdString } from '~/utils/objectId';
import { MEMORY_KEY_PATTERN } from '~/schema/memory';
import logger from '~/config/winston';

/**
 * Formats a date in YYYY-MM-DD format
 */
const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/** Partition filter: `agentId`/`chatProjectId: null` match both null and missing fields,
 *  so pre-partition entries remain part of the shared personal pool. */
const partitionFilter = (agentId?: string, chatProjectId?: string) => ({
  agentId: agentId ?? null,
  chatProjectId: chatProjectId ?? null,
});

// Factory function that takes mongoose instance and returns the methods
export function createMemoryMethods(mongoose: typeof import('mongoose')): {
  setMemory: ({
    userId,
    key,
    value,
    tokenCount,
    agentId,
    chatProjectId,
  }: t.SetMemoryParams) => Promise<t.MemoryResult>;
  revertMemory: (params: t.RevertMemoryParams) => Promise<t.RevertMemoryResult>;
  replacePartitionMemories: (
    params: t.ReplacePartitionMemoriesParams,
  ) => Promise<t.ReplacePartitionMemoriesResult>;
  restorePartitionMemories: (
    params: t.RestorePartitionMemoriesParams,
  ) => Promise<t.RestorePartitionMemoriesResult>;
  createMemory: ({
    userId,
    key,
    value,
    title,
    tokenCount,
    agentId,
    chatProjectId,
  }: t.CreateMemoryParams) => Promise<t.MemoryResult>;
  deleteMemory: ({
    userId,
    key,
    agentId,
    chatProjectId,
  }: t.DeleteMemoryParams) => Promise<t.MemoryResult>;
  setMemoryById: (params: t.SetMemoryByIdParams) => Promise<t.SetMemoryByIdResult>;
  deleteMemoryById: (params: t.MemoryByIdParams) => Promise<t.MemoryResult>;
  getAllUserMemories: (userId: string | Types.ObjectId) => Promise<t.IMemoryEntryLean[]>;
  getUserMemories: ({
    userId,
    agentId,
    chatProjectId,
  }: t.GetUserMemoriesParams) => Promise<t.IMemoryEntryLean[]>;
  getFormattedMemories: ({
    userId,
    agentId,
    chatProjectId,
  }: t.GetFormattedMemoriesParams) => Promise<t.FormattedMemoriesResult>;
  deleteAllUserMemories: (userId: string | Types.ObjectId) => Promise<number>;
} {
  /**
   * Validates that a chat project exists and belongs to the given user.
   */
  /**
   * Guards both write paths against a key the schema would reject. `setMemory` upserts
   * through `findOneAndUpdate`, where `key` sits in the filter rather than the update,
   * so the schema validator never sees it — a bad key would be stored and then be
   * uneditable through the memory UI, which validates the same shape.
   */
  function isValidMemoryKey(key: string): boolean {
    return MEMORY_KEY_PATTERN.test(key);
  }

  /**
   * Resolves a caller-supplied chat project id to the partition value to store, or
   * `null` when the project does not exist or belongs to someone else.
   *
   * The returned value is the CANONICAL id, not the string that came in:
   * `isValidObjectIdString` accepts either case, so an upper-cased id would otherwise
   * create a second partition that the panel's project filter never groups with the
   * real one and that `deleteChatProject`'s exact-match cleanup would never reach.
   */
  async function resolveChatProjectPartition(
    userId: string | Types.ObjectId,
    chatProjectId: string,
  ): Promise<string | null> {
    if (!isValidObjectIdString(chatProjectId)) {
      return null;
    }

    const projectObjectId = new mongoose.Types.ObjectId(chatProjectId);
    const ChatProject = mongoose.models.ChatProject as Model<t.IChatProjectDocument>;
    const project = await ChatProject.exists({
      _id: projectObjectId,
      user: userId.toString(),
    });
    return project != null ? projectObjectId.toString() : null;
  }
  async function createMemory({
    userId,
    key,
    value,
    title,
    tokenCount = 0,
    agentId,
    chatProjectId,
  }: t.CreateMemoryParams): Promise<t.MemoryResult> {
    try {
      if (key?.toLowerCase() === 'nothing') {
        return { ok: false };
      }

      if (key != null && !isValidMemoryKey(key)) {
        logger.warn(`[createMemory] Rejected memory write for a malformed key`, {
          keyLength: key?.length,
        });
        return { ok: false, reason: 'invalid_key' };
      }

      let partitionChatProjectId: string | undefined;
      if (chatProjectId) {
        const resolved = await resolveChatProjectPartition(userId, chatProjectId);
        if (resolved == null) {
          logger.warn(
            `[createMemory] Rejected memory write for unknown or unauthorized chatProjectId: ${chatProjectId}`,
          );
          return { ok: false, reason: 'invalid_project' };
        }
        partitionChatProjectId = resolved;
      }

      const MemoryEntry = mongoose.models.MemoryEntry;
      const normalizedTitle = normalizeMemoryTitle(title);

      let resolvedKey = key;
      if (resolvedKey == null) {
        const occupiedEntries = await MemoryEntry.find(
          { userId, ...partitionFilter(agentId, partitionChatProjectId) },
          { key: 1, _id: 0 },
        ).lean<Array<{ key: string }>>();
        const takenKeys = new Set(occupiedEntries.map((entry) => entry.key));
        resolvedKey = resolveMemoryKey(normalizedTitle ?? value, takenKeys);
      } else {
        const existingMemory = await MemoryEntry.findOne({
          userId,
          key: resolvedKey,
          ...partitionFilter(agentId, partitionChatProjectId),
        });
        if (existingMemory) {
          throw new Error('Memory with this key already exists');
        }
      }

      await MemoryEntry.create({
        userId,
        key: resolvedKey,
        value,
        tokenCount,
        ...(normalizedTitle ? { title: normalizedTitle } : {}),
        ...(agentId ? { agentId } : {}),
        ...(partitionChatProjectId ? { chatProjectId: partitionChatProjectId } : {}),
        updated_at: new Date(),
      });

      return { ok: true, key: resolvedKey, title: normalizedTitle };
    } catch (error) {
      throw new Error(
        `Failed to create memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Sets or updates a memory entry for a user
   */
  async function setMemory({
    userId,
    key,
    value,
    title,
    tokenCount = 0,
    agentId,
    chatProjectId,
  }: t.SetMemoryParams): Promise<t.MemoryResult> {
    try {
      if (key?.toLowerCase() === 'nothing') {
        return { ok: false };
      }

      if (!isValidMemoryKey(key)) {
        logger.warn(`[setMemory] Rejected memory write for a malformed key`, {
          keyLength: key?.length,
        });
        return { ok: false, reason: 'invalid_key' };
      }

      let partitionChatProjectId: string | undefined;
      if (chatProjectId) {
        const resolved = await resolveChatProjectPartition(userId, chatProjectId);
        if (resolved == null) {
          logger.warn(
            `[setMemory] Rejected memory write for unknown or unauthorized chatProjectId: ${chatProjectId}`,
          );
          return { ok: false, reason: 'invalid_project' };
        }
        partitionChatProjectId = resolved;
      }

      const normalizedTitle = normalizeMemoryTitle(title);
      const MemoryEntry = mongoose.models.MemoryEntry;
      const prior = (await MemoryEntry.findOneAndUpdate(
        { userId, key, ...partitionFilter(agentId, partitionChatProjectId) },
        {
          value,
          tokenCount,
          ...(normalizedTitle ? { title: normalizedTitle } : {}),
          ...(agentId ? { agentId } : {}),
          ...(partitionChatProjectId ? { chatProjectId: partitionChatProjectId } : {}),
          updated_at: new Date(),
        },
        {
          upsert: true,
          new: false,
        },
      ).lean()) as t.IMemoryEntryLean | null;

      return {
        ok: true,
        created: prior == null,
        previous: prior
          ? { value: prior.value, title: prior.title, tokenCount: prior.tokenCount }
          : null,
      };
    } catch (error) {
      throw new Error(
        `Failed to set memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async function revertMemory({
    userId,
    key,
    agentId,
    chatProjectId,
    expectedValue,
    previous,
  }: t.RevertMemoryParams): Promise<t.RevertMemoryResult> {
    try {
      let partitionChatProjectId: string | undefined;
      if (chatProjectId) {
        const resolved = await resolveChatProjectPartition(userId, chatProjectId);
        if (resolved == null) {
          logger.warn(
            `[revertMemory] Rejected memory revert for unknown or unauthorized chatProjectId: ${chatProjectId}`,
          );
          return { ok: false, reason: 'invalid_project' };
        }
        partitionChatProjectId = resolved;
      }

      const MemoryEntry = mongoose.models.MemoryEntry;
      const partition = partitionFilter(agentId, partitionChatProjectId);
      const filter = { userId, key, ...partition, value: expectedValue };

      if (previous == null) {
        const deleted = await MemoryEntry.findOneAndDelete(filter).lean();
        if (deleted) {
          return { ok: true };
        }
      } else {
        const normalizedTitle = normalizeMemoryTitle(previous.title);
        const update: Record<string, unknown> = {
          $set: {
            value: previous.value,
            tokenCount: previous.tokenCount,
            updated_at: new Date(),
            ...(normalizedTitle ? { title: normalizedTitle } : {}),
          },
        };
        if (!normalizedTitle) {
          update.$unset = { title: 1 };
        }
        const updated = await MemoryEntry.findOneAndUpdate(filter, update).lean();
        if (updated) {
          return { ok: true };
        }
      }

      const stillExists = await MemoryEntry.exists({ userId, key, ...partition });
      return { ok: false, reason: stillExists ? 'changed' : 'not_found' };
    } catch (error) {
      throw new Error(
        `Failed to revert memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  function sameUpdatedAt(a?: Date | null, b?: Date | null): boolean {
    return (a?.getTime() ?? null) === (b?.getTime() ?? null);
  }

  async function replacePartitionMemories({
    userId,
    agentId,
    chatProjectId,
    expected,
    entries,
  }: t.ReplacePartitionMemoriesParams): Promise<t.ReplacePartitionMemoriesResult> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry as Model<t.IMemoryEntry>;
      const current = await MemoryEntry.find(
        { userId, ...partitionFilter(agentId, chatProjectId) },
        { _id: 1, updated_at: 1 },
      ).lean<Array<{ _id: Types.ObjectId; updated_at?: Date | null }>>();

      const expectedById = new Map(
        expected.map((entry) => [entry._id.toString(), entry.updated_at ?? null]),
      );
      const unchanged =
        current.length === expectedById.size &&
        current.every(
          (entry) =>
            expectedById.has(entry._id.toString()) &&
            sameUpdatedAt(entry.updated_at, expectedById.get(entry._id.toString())),
        );
      if (!unchanged) {
        return { ok: false, reason: 'changed' };
      }

      const appliedAt = new Date();
      const docs = entries.map((entry) => ({
        _id: new Types.ObjectId(),
        userId,
        key: entry.key,
        value: entry.value,
        tokenCount: entry.tokenCount,
        ...(entry.title ? { title: entry.title } : {}),
        ...(agentId ? { agentId } : {}),
        ...(chatProjectId ? { chatProjectId } : {}),
        updated_at: appliedAt,
      }));
      const insertedIds = docs.map((doc) => doc._id);
      const discardInserted = () =>
        MemoryEntry.deleteMany({ userId, _id: { $in: insertedIds } }).catch((cleanupError) => {
          logger.error(
            '[replacePartitionMemories] Failed to discard inserted entries',
            cleanupError,
          );
        });

      if (docs.length > 0) {
        try {
          await MemoryEntry.insertMany(docs);
        } catch (error) {
          await discardInserted();
          throw error;
        }
      }

      if (current.length > 0) {
        try {
          await MemoryEntry.deleteMany({
            userId,
            $or: current.map((entry) => ({ _id: entry._id, updated_at: entry.updated_at ?? null })),
          });
        } catch (error) {
          await discardInserted();
          throw error;
        }
      }

      return { ok: true, insertedIds: insertedIds.map((id) => id.toString()), appliedAt };
    } catch (error) {
      throw new Error(
        `Failed to replace partition memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async function restorePartitionMemories({
    userId,
    agentId,
    chatProjectId,
    compactedIds,
    appliedAt,
    entries,
  }: t.RestorePartitionMemoriesParams): Promise<t.RestorePartitionMemoriesResult> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry as Model<t.IMemoryEntry>;
      const current = await MemoryEntry.find(
        { userId, ...partitionFilter(agentId, chatProjectId) },
        { _id: 1, key: 1, updated_at: 1 },
      ).lean<Array<{ _id: Types.ObjectId; key: string; updated_at?: Date | null }>>();

      const compacted = new Set(compactedIds);
      const removable = current.filter(
        (entry) =>
          appliedAt != null &&
          compacted.has(entry._id.toString()) &&
          entry.updated_at != null &&
          entry.updated_at.getTime() <= appliedAt.getTime(),
      );
      const removableIds = new Set(removable.map((entry) => entry._id.toString()));
      const occupiedKeys = new Set(
        current
          .filter((entry) => !removableIds.has(entry._id.toString()))
          .map((entry) => entry.key),
      );

      const docs = [];
      for (const entry of entries) {
        if (occupiedKeys.has(entry.key)) {
          continue;
        }
        occupiedKeys.add(entry.key);
        docs.push({
          _id: new Types.ObjectId(),
          userId: new Types.ObjectId(userId.toString()),
          key: entry.key,
          value: entry.value ?? '',
          tokenCount: entry.tokenCount ?? 0,
          ...(entry.title ? { title: entry.title } : {}),
          ...(agentId ? { agentId } : {}),
          ...(chatProjectId ? { chatProjectId } : {}),
          updated_at: entry.updated_at ?? new Date(),
        });
      }

      if (docs.length > 0) {
        await MemoryEntry.insertMany(docs, { lean: true });
      }
      if (removable.length > 0 && appliedAt != null) {
        await MemoryEntry.deleteMany({
          userId,
          _id: { $in: removable.map((entry) => entry._id) },
          updated_at: { $lte: appliedAt },
        });
      }

      return { restored: docs.length };
    } catch (error) {
      throw new Error(
        `Failed to restore partition memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Deletes a specific memory entry for a user
   */
  async function deleteMemory({
    userId,
    key,
    agentId,
    chatProjectId,
  }: t.DeleteMemoryParams): Promise<t.MemoryResult> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry;
      const result = (await MemoryEntry.findOneAndDelete({
        userId,
        key,
        ...partitionFilter(agentId, chatProjectId),
      }).lean()) as t.IMemoryEntryLean | null;
      return { ok: !!result, title: result?.title };
    } catch (error) {
      throw new Error(
        `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /** Updates an existing memory without requiring its authored key. */
  async function setMemoryById({
    userId,
    id,
    key,
    value,
    title,
    tokenCount = 0,
    agentId,
    chatProjectId,
  }: t.SetMemoryByIdParams): Promise<t.SetMemoryByIdResult> {
    try {
      if (!mongoose.Types.ObjectId.isValid(id) || key?.toLowerCase() === 'nothing') {
        return { ok: false };
      }

      const MemoryEntry = mongoose.models.MemoryEntry;
      const recordFilter = { _id: id, userId, ...partitionFilter(agentId, chatProjectId) };
      const existingMemory = (await MemoryEntry.findOne(
        recordFilter,
      ).lean()) as t.IMemoryEntryLean | null;
      if (!existingMemory) {
        return { ok: false };
      }

      if (key != null && key !== existingMemory.key) {
        const duplicate = await MemoryEntry.exists({
          userId,
          key,
          ...partitionFilter(agentId, chatProjectId),
          _id: { $ne: existingMemory._id },
        });
        if (duplicate) {
          return { ok: false, conflict: true };
        }
      }

      const normalizedTitle = normalizeMemoryTitle(title);
      const updatedMemory = (await MemoryEntry.findOneAndUpdate(
        recordFilter,
        {
          ...(key != null ? { key } : {}),
          value,
          tokenCount,
          ...(normalizedTitle ? { title: normalizedTitle } : {}),
          updated_at: new Date(),
        },
        { new: true, runValidators: true },
      ).lean()) as t.IMemoryEntryLean | null;

      return updatedMemory ? { ok: true, memory: updatedMemory } : { ok: false };
    } catch (error) {
      throw new Error(
        `Failed to update memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /** Deletes an existing memory without requiring its authored key. */
  async function deleteMemoryById({
    userId,
    id,
    agentId,
    chatProjectId,
  }: t.MemoryByIdParams): Promise<t.MemoryResult> {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return { ok: false };
      }

      const MemoryEntry = mongoose.models.MemoryEntry;
      const result = await MemoryEntry.findOneAndDelete({
        _id: id,
        userId,
        ...partitionFilter(agentId, chatProjectId),
      });
      return { ok: !!result };
    } catch (error) {
      throw new Error(
        `Failed to delete memory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Gets all memory entries for a user across every partition
   */
  async function getAllUserMemories(
    userId: string | Types.ObjectId,
  ): Promise<t.IMemoryEntryLean[]> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry;
      return (await MemoryEntry.find({ userId }).lean()) as t.IMemoryEntryLean[];
    } catch (error) {
      throw new Error(
        `Failed to get all memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Gets a user's memory entries for a single partition
   * (the shared personal pool when `agentId` is omitted)
   */
  async function getUserMemories({
    userId,
    agentId,
    chatProjectId,
  }: t.GetUserMemoriesParams): Promise<t.IMemoryEntryLean[]> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry;
      return (await MemoryEntry.find({
        userId,
        ...partitionFilter(agentId, chatProjectId),
      }).lean()) as t.IMemoryEntryLean[];
    } catch (error) {
      throw new Error(
        `Failed to get memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Gets and formats a partition's memories for a user in two different formats
   */
  async function getFormattedMemories({
    userId,
    agentId,
    chatProjectId,
  }: t.GetFormattedMemoriesParams): Promise<t.FormattedMemoriesResult> {
    try {
      const memories = await getUserMemories({ userId, agentId, chatProjectId });

      if (!memories || memories.length === 0) {
        return { withKeys: '', withoutKeys: '', totalTokens: 0 };
      }

      const sortedMemories = memories.sort(
        (a, b) => new Date(a.updated_at!).getTime() - new Date(b.updated_at!).getTime(),
      );

      const totalTokens = sortedMemories.reduce((sum, memory) => {
        return sum + (memory.tokenCount || 0);
      }, 0);

      const withKeys = sortedMemories
        .map((memory, index) => {
          const date = formatDate(new Date(memory.updated_at!));
          const titleInfo = memory.title ? ` ["title": "${memory.title}"]` : '';
          const tokenInfo = memory.tokenCount ? ` [${memory.tokenCount} tokens]` : '';
          return `${index + 1}. [${date}]${titleInfo}. ["key": "${memory.key}"]${tokenInfo}. ["value": "${memory.value}"]`;
        })
        .join('\n\n');

      const withoutKeys = sortedMemories
        .map((memory, index) => {
          const date = formatDate(new Date(memory.updated_at!));
          const titleInfo = memory.title ? ` ["title": "${memory.title}"]` : '';
          return `${index + 1}. [${date}]${titleInfo}. ${memory.value}`;
        })
        .join('\n\n');

      return { withKeys, withoutKeys, totalTokens };
    } catch (error) {
      logger.error('Failed to get formatted memories:', error);
      return { withKeys: '', withoutKeys: '', totalTokens: 0 };
    }
  }

  /**
   * Deletes all memory entries for a user
   */
  async function deleteAllUserMemories(userId: string | Types.ObjectId): Promise<number> {
    try {
      const MemoryEntry = mongoose.models.MemoryEntry;
      const result = await MemoryEntry.deleteMany({ userId });
      await mongoose.models.MemorySnapshot?.deleteMany({ userId });
      return result.deletedCount;
    } catch (error) {
      throw new Error(
        `Failed to delete all user memories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return {
    setMemory,
    revertMemory,
    replacePartitionMemories,
    restorePartitionMemories,
    createMemory,
    deleteMemory,
    setMemoryById,
    deleteMemoryById,
    getAllUserMemories,
    getUserMemories,
    getFormattedMemories,
    deleteAllUserMemories,
  };
}

export type MemoryMethods = ReturnType<typeof createMemoryMethods>;
