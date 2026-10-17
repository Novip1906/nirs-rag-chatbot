import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IMemoryEntry, IChatProjectDocument } from '~/types';
import { createMemoryMethods, type MemoryMethods } from './memory';
import { tenantStorage } from '~/config/tenantContext';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let MemoryEntry: mongoose.Model<IMemoryEntry>;
let ChatProject: mongoose.Model<IChatProjectDocument>;
let methods: MemoryMethods;

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const agentId = 'agent_partition_a';
const otherAgentId = 'agent_partition_b';

let chatProjectId: string;
let otherChatProjectId: string;
let foreignChatProjectId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  MemoryEntry = mongoose.models.MemoryEntry as mongoose.Model<IMemoryEntry>;
  ChatProject = mongoose.models.ChatProject as mongoose.Model<IChatProjectDocument>;
  methods = createMemoryMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());

  const project = await ChatProject.create({ name: 'Project A', user: userId.toString() });
  chatProjectId = project._id.toString();
  const otherProject = await ChatProject.create({ name: 'Project B', user: userId.toString() });
  otherChatProjectId = otherProject._id.toString();
  const foreignProject = await ChatProject.create({
    name: 'Foreign Project',
    user: otherUserId.toString(),
  });
  foreignChatProjectId = foreignProject._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await MemoryEntry.deleteMany({});
});

describe('memory partitions', () => {
  it('writes to the shared personal pool when agentId is omitted', async () => {
    await methods.setMemory({ userId, key: 'preference', value: 'likes tea', tokenCount: 3 });

    const personal = await methods.getUserMemories({ userId });
    expect(personal).toHaveLength(1);
    expect(personal[0].agentId == null).toBe(true);

    const agentScoped = await methods.getUserMemories({ userId, agentId });
    expect(agentScoped).toHaveLength(0);
  });

  it('isolates the same key across partitions', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });
    await methods.setMemory({ userId, key: 'context', value: 'agent a', tokenCount: 2, agentId });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'agent b',
      tokenCount: 3,
      agentId: otherAgentId,
    });

    const personal = await methods.getUserMemories({ userId });
    const partitionA = await methods.getUserMemories({ userId, agentId });
    const partitionB = await methods.getUserMemories({ userId, agentId: otherAgentId });

    expect(personal.map((m) => m.value)).toEqual(['personal']);
    expect(partitionA.map((m) => m.value)).toEqual(['agent a']);
    expect(partitionB.map((m) => m.value)).toEqual(['agent b']);
    expect(await MemoryEntry.countDocuments({ userId })).toBe(3);
  });

  it('upserts within a partition instead of duplicating', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first', tokenCount: 1, agentId });
    await methods.setMemory({ userId, key: 'context', value: 'second', tokenCount: 2, agentId });

    const partitionA = await methods.getUserMemories({ userId, agentId });
    expect(partitionA).toHaveLength(1);
    expect(partitionA[0].value).toBe('second');
  });

  it('treats legacy entries without an agentId field as the personal pool', async () => {
    await MemoryEntry.collection.insertOne({
      userId,
      key: 'legacy',
      value: 'pre-partition entry',
      tokenCount: 4,
      updated_at: new Date(),
    });

    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => m.key)).toEqual(['legacy']);

    await methods.setMemory({ userId, key: 'legacy', value: 'updated', tokenCount: 4 });
    expect(await MemoryEntry.countDocuments({ userId })).toBe(1);
    expect((await methods.getUserMemories({ userId }))[0].value).toBe('updated');
  });

  it('deletes only within the targeted partition', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });
    await methods.setMemory({ userId, key: 'context', value: 'agent a', tokenCount: 2, agentId });

    const agentDelete = await methods.deleteMemory({ userId, key: 'context', agentId });
    expect(agentDelete.ok).toBe(true);
    expect(await methods.getUserMemories({ userId })).toHaveLength(1);
    expect(await methods.getUserMemories({ userId, agentId })).toHaveLength(0);

    const missingDelete = await methods.deleteMemory({ userId, key: 'context', agentId });
    expect(missingDelete.ok).toBe(false);
  });

  it('updates by opaque id only for the owning user and selected partition', async () => {
    await methods.setMemory({
      userId,
      key: 'private_key',
      value: 'before',
      tokenCount: 1,
      agentId,
    });
    const [stored] = await methods.getUserMemories({ userId, agentId });
    const id = stored._id.toString();

    await expect(
      methods.setMemoryById({
        userId: otherUserId,
        id,
        value: 'wrong owner',
        tokenCount: 2,
        agentId,
      }),
    ).resolves.toEqual({ ok: false });
    await expect(
      methods.setMemoryById({
        userId,
        id,
        value: 'wrong partition',
        tokenCount: 2,
        agentId: otherAgentId,
      }),
    ).resolves.toEqual({ ok: false });

    const result = await methods.setMemoryById({
      userId,
      id,
      value: 'after',
      tokenCount: 2,
      agentId,
    });

    expect(result).toMatchObject({
      ok: true,
      memory: { key: 'private_key', value: 'after', tokenCount: 2, agentId },
    });
    expect(await methods.getUserMemories({ userId, agentId })).toHaveLength(1);
  });

  it('renames by opaque id without creating a duplicate record', async () => {
    await methods.setMemory({ userId, key: 'first', value: 'one', agentId });
    await methods.setMemory({ userId, key: 'second', value: 'two', agentId });
    const first = (await methods.getUserMemories({ userId, agentId })).find(
      (memory) => memory.key === 'first',
    );
    expect(first).toBeDefined();

    const conflict = await methods.setMemoryById({
      userId,
      id: first?._id.toString() ?? '',
      key: 'second',
      value: 'updated',
      agentId,
    });
    expect(conflict).toEqual({ ok: false, conflict: true });

    const renamed = await methods.setMemoryById({
      userId,
      id: first?._id.toString() ?? '',
      key: 'renamed',
      value: 'updated',
      agentId,
    });
    expect(renamed).toMatchObject({ ok: true, memory: { key: 'renamed', value: 'updated' } });
    expect(await MemoryEntry.countDocuments({ userId, agentId })).toBe(2);
  });

  it('updates and deletes by opaque id only in the owning tenant', async () => {
    const id = await tenantStorage.run({ tenantId: 'tenant-a' }, async () => {
      await methods.setMemory({ userId, key: 'private_key', value: 'stored', agentId });
      const [stored] = await methods.getUserMemories({ userId, agentId });
      return stored._id.toString();
    });

    await expect(
      tenantStorage.run({ tenantId: 'tenant-b' }, async () =>
        methods.setMemoryById({ userId, id, value: 'wrong tenant', agentId }),
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      tenantStorage.run({ tenantId: 'tenant-a' }, async () =>
        methods.getUserMemories({ userId, agentId }),
      ),
    ).resolves.toEqual([expect.objectContaining({ value: 'stored' })]);
    await expect(
      tenantStorage.run({ tenantId: 'tenant-b' }, async () =>
        methods.deleteMemoryById({ userId, id, agentId }),
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      tenantStorage.run({ tenantId: 'tenant-a' }, async () =>
        methods.deleteMemoryById({ userId: otherUserId, id, agentId }),
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      tenantStorage.run({ tenantId: 'tenant-a' }, async () =>
        methods.deleteMemoryById({ userId, id, agentId: otherAgentId }),
      ),
    ).resolves.toEqual({ ok: false });
    await expect(
      tenantStorage.run({ tenantId: 'tenant-a' }, async () =>
        methods.deleteMemoryById({ userId, id, agentId }),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('scopes createMemory duplicate detection to the partition', async () => {
    await methods.createMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });

    await expect(
      methods.createMemory({ userId, key: 'context', value: 'dupe', tokenCount: 1 }),
    ).rejects.toThrow('already exists');

    const created = await methods.createMemory({
      userId,
      key: 'context',
      value: 'agent a',
      tokenCount: 2,
      agentId,
    });
    expect(created.ok).toBe(true);
  });

  it('formats memories per partition with partition-scoped totals', async () => {
    await methods.setMemory({ userId, key: 'one', value: 'personal one', tokenCount: 5 });
    await methods.setMemory({ userId, key: 'two', value: 'agent two', tokenCount: 7, agentId });

    const personal = await methods.getFormattedMemories({ userId });
    expect(personal.totalTokens).toBe(5);
    expect(personal.withoutKeys).toContain('personal one');
    expect(personal.withoutKeys).not.toContain('agent two');

    const partitionA = await methods.getFormattedMemories({ userId, agentId });
    expect(partitionA.totalTokens).toBe(7);
    expect(partitionA.withKeys).toContain('"key": "two"');
    expect(partitionA.withKeys).not.toContain('personal one');
  });

  it('returns every partition from getAllUserMemories and wipes them all on deleteAllUserMemories', async () => {
    await methods.setMemory({ userId, key: 'one', value: 'personal', tokenCount: 1 });
    await methods.setMemory({ userId, key: 'two', value: 'agent a', tokenCount: 1, agentId });
    await methods.setMemory({ userId: otherUserId, key: 'three', value: 'other', tokenCount: 1 });

    const all = await methods.getAllUserMemories(userId);
    expect(all).toHaveLength(2);

    const deleted = await methods.deleteAllUserMemories(userId);
    expect(deleted).toBe(2);
    expect(await MemoryEntry.countDocuments({ userId: otherUserId })).toBe(1);
  });

  it('deleteAllUserMemories also removes the user compaction snapshots', async () => {
    const MemorySnapshot = mongoose.models.MemorySnapshot;
    const snapshot = { entries: [], reason: 'manual', before: 0 };
    await MemorySnapshot.create({ ...snapshot, userId });
    await MemorySnapshot.create({ ...snapshot, userId, chatProjectId });
    await MemorySnapshot.create({ ...snapshot, userId: otherUserId });

    await methods.deleteAllUserMemories(userId);

    expect(await MemorySnapshot.countDocuments({ userId })).toBe(0);
    expect(await MemorySnapshot.countDocuments({ userId: otherUserId })).toBe(1);
  });
});

describe('memory chat project partitions', () => {
  it('writes to the shared personal pool when chatProjectId is omitted', async () => {
    await methods.setMemory({ userId, key: 'preference', value: 'likes tea', tokenCount: 3 });

    const personal = await methods.getUserMemories({ userId });
    expect(personal).toHaveLength(1);
    expect(personal[0].chatProjectId == null).toBe(true);

    const projectScoped = await methods.getUserMemories({ userId, chatProjectId });
    expect(projectScoped).toHaveLength(0);
  });

  it('isolates the same key across the personal pool and project partitions', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'project a',
      tokenCount: 2,
      chatProjectId,
    });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'project b',
      tokenCount: 3,
      chatProjectId: otherChatProjectId,
    });

    const personal = await methods.getUserMemories({ userId });
    const partitionA = await methods.getUserMemories({ userId, chatProjectId });
    const partitionB = await methods.getUserMemories({ userId, chatProjectId: otherChatProjectId });

    expect(personal.map((m) => m.value)).toEqual(['personal']);
    expect(partitionA.map((m) => m.value)).toEqual(['project a']);
    expect(partitionB.map((m) => m.value)).toEqual(['project b']);
    expect(await MemoryEntry.countDocuments({ userId })).toBe(3);
  });

  it('treats legacy entries without a chatProjectId field as the personal pool', async () => {
    await MemoryEntry.collection.insertOne({
      userId,
      key: 'legacy',
      value: 'pre-partition entry',
      tokenCount: 4,
      updated_at: new Date(),
    });

    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => m.key)).toEqual(['legacy']);

    await methods.setMemory({ userId, key: 'legacy', value: 'updated', tokenCount: 4 });
    expect(await MemoryEntry.countDocuments({ userId })).toBe(1);
    expect((await methods.getUserMemories({ userId }))[0].value).toBe('updated');
  });

  it('keeps agentId and chatProjectId as independent partitioning axes', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'agent only',
      tokenCount: 1,
      agentId,
    });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'project only',
      tokenCount: 1,
      chatProjectId,
    });
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'agent and project',
      tokenCount: 1,
      agentId,
      chatProjectId,
    });

    expect((await methods.getUserMemories({ userId })).map((m) => m.value)).toEqual(['personal']);
    expect((await methods.getUserMemories({ userId, agentId })).map((m) => m.value)).toEqual([
      'agent only',
    ]);
    expect((await methods.getUserMemories({ userId, chatProjectId })).map((m) => m.value)).toEqual([
      'project only',
    ]);
    expect(
      (await methods.getUserMemories({ userId, agentId, chatProjectId })).map((m) => m.value),
    ).toEqual(['agent and project']);
    expect(await MemoryEntry.countDocuments({ userId })).toBe(4);
  });

  it('rejects writes with an unowned or nonexistent chatProjectId without writing anything', async () => {
    const nonExistentId = new mongoose.Types.ObjectId().toString();

    await expect(
      methods.setMemory({
        userId,
        key: 'context',
        value: 'should not persist',
        tokenCount: 1,
        chatProjectId: foreignChatProjectId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_project' });
    await expect(
      methods.setMemory({
        userId,
        key: 'context',
        value: 'should not persist',
        tokenCount: 1,
        chatProjectId: nonExistentId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_project' });
    await expect(
      methods.createMemory({
        userId,
        key: 'context',
        value: 'should not persist',
        tokenCount: 1,
        chatProjectId: foreignChatProjectId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_project' });

    expect(await MemoryEntry.countDocuments({ userId })).toBe(0);
  });

  it('rejects a key the memory UI would refuse to edit', async () => {
    await expect(
      methods.setMemory({ userId, key: 'Q3 Roadmap', value: 'x', tokenCount: 1, chatProjectId }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_key' });
    await expect(
      methods.createMemory({ userId, key: 'Q3 Roadmap', value: 'x', tokenCount: 1 }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_key' });

    expect(await MemoryEntry.countDocuments({ userId })).toBe(0);
  });

  it('stores the canonical project id so a differently-cased one is the same partition', async () => {
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'written with an upper-cased id',
      tokenCount: 1,
      chatProjectId: chatProjectId.toUpperCase(),
    });

    const stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.chatProjectId).toBe(chatProjectId);
    expect(await methods.getUserMemories({ userId, chatProjectId })).toHaveLength(1);
  });
});

describe('setMemory previous/created', () => {
  it('reports created: true and previous: null for a brand-new key', async () => {
    const result = await methods.setMemory({
      userId,
      key: 'fresh',
      value: 'first value',
      title: 'Fresh',
      tokenCount: 3,
    });

    expect(result).toEqual({ ok: true, created: true, previous: null });
  });

  it('reports created: false and the prior state for an overwritten key', async () => {
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'first value',
      title: 'First',
      tokenCount: 3,
    });

    const result = await methods.setMemory({
      userId,
      key: 'context',
      value: 'second value',
      title: 'Second',
      tokenCount: 5,
    });

    expect(result).toEqual({
      ok: true,
      created: false,
      previous: { value: 'first value', title: 'First', tokenCount: 3 },
    });
    const stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.value).toBe('second value');
    expect(stored?.title).toBe('Second');
  });

  it('carries an undefined previous title when the overwritten record had none', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first value', tokenCount: 3 });

    const result = await methods.setMemory({
      userId,
      key: 'context',
      value: 'second value',
      tokenCount: 5,
    });

    expect(result.previous).toEqual({ value: 'first value', title: undefined, tokenCount: 3 });
  });

  it('scopes previous/created to the partition being written', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal', tokenCount: 1 });

    const result = await methods.setMemory({
      userId,
      key: 'context',
      value: 'agent a',
      tokenCount: 2,
      agentId,
    });

    expect(result).toEqual({ ok: true, created: true, previous: null });
  });
});

describe('revertMemory', () => {
  it('deletes a newly-created record when previous is null', async () => {
    const write = await methods.setMemory({ userId, key: 'fresh', value: 'new value' });
    expect(write.created).toBe(true);

    const result = await methods.revertMemory({
      userId,
      key: 'fresh',
      expectedValue: 'new value',
      previous: null,
    });

    expect(result).toEqual({ ok: true });
    expect(await MemoryEntry.findOne({ userId, key: 'fresh' }).lean()).toBeNull();
  });

  it('restores the prior value and title of an overwritten record', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first', title: 'First' });
    const overwrite = await methods.setMemory({ userId, key: 'context', value: 'second' });
    expect(overwrite.previous).toEqual({ value: 'first', title: 'First', tokenCount: 0 });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      expectedValue: 'second',
      previous: { value: 'first', title: 'First', tokenCount: 0 },
    });

    expect(result).toEqual({ ok: true });
    const stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.value).toBe('first');
    expect(stored?.title).toBe('First');
  });

  it('unsets the title when reverting to a record that had none', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first' });
    await methods.setMemory({ userId, key: 'context', value: 'second', title: 'Added later' });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      expectedValue: 'second',
      previous: { value: 'first', tokenCount: 0 },
    });

    expect(result).toEqual({ ok: true });
    const stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.value).toBe('first');
    expect(stored?.title).toBeUndefined();
  });

  it('refuses to revert when the record moved on since the write, without touching it', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first' });
    await methods.setMemory({ userId, key: 'context', value: 'second' });
    await methods.setMemory({ userId, key: 'context', value: 'third' });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      expectedValue: 'second',
      previous: { value: 'first', tokenCount: 0 },
    });

    expect(result).toEqual({ ok: false, reason: 'changed' });
    const stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.value).toBe('third');
  });

  it('reports not_found when the record was deleted since the write', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first' });
    await methods.deleteMemory({ userId, key: 'context' });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      expectedValue: 'first',
      previous: null,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports not_found for a delete-revert when someone already reverted it', async () => {
    await methods.setMemory({ userId, key: 'fresh', value: 'new value' });

    const first = await methods.revertMemory({
      userId,
      key: 'fresh',
      expectedValue: 'new value',
      previous: null,
    });
    expect(first).toEqual({ ok: true });

    const second = await methods.revertMemory({
      userId,
      key: 'fresh',
      expectedValue: 'new value',
      previous: null,
    });
    expect(second).toEqual({ ok: false, reason: 'not_found' });
  });

  it('only reverts within the targeted partition', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal' });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      agentId,
      expectedValue: 'personal',
      previous: null,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(
      (await MemoryEntry.findOne({ userId, key: 'context', agentId: null }).lean())?.value,
    ).toBe('personal');
  });

  it('reports changed (not not_found) when the key exists in the partition under a different value', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'personal' });
    await methods.setMemory({ userId, key: 'context', value: 'agent a', agentId });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      agentId,
      expectedValue: 'stale expectation',
      previous: null,
    });

    expect(result).toEqual({ ok: false, reason: 'changed' });
  });

  it('reverts within a chat-project partition using the canonical project id', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'first', chatProjectId });
    await methods.setMemory({ userId, key: 'context', value: 'second', chatProjectId });

    const result = await methods.revertMemory({
      userId,
      key: 'context',
      chatProjectId: chatProjectId.toUpperCase(),
      expectedValue: 'second',
      previous: { value: 'first', tokenCount: 0 },
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects a revert against an unowned or nonexistent chatProjectId', async () => {
    const result = await methods.revertMemory({
      userId,
      key: 'context',
      chatProjectId: foreignChatProjectId,
      expectedValue: 'first',
      previous: null,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_project' });
  });
});

describe('replacePartitionMemories', () => {
  async function readExpected(filter: { agentId?: string; chatProjectId?: string } = {}) {
    const entries = await methods.getUserMemories({ userId, ...filter });
    return entries.map((entry) => ({ _id: entry._id, updated_at: entry.updated_at }));
  }

  it('inserts the compacted entries and deletes only the entries it read', async () => {
    await methods.setMemory({ userId, key: 'stale_one', value: 'stale value 1', tokenCount: 1 });
    await methods.setMemory({ userId, key: 'stale_two', value: 'stale value 2', tokenCount: 2 });
    await methods.setMemory({
      userId,
      key: 'other_partition',
      value: 'untouched',
      tokenCount: 1,
      agentId,
    });
    const expected = await readExpected();

    const result = await methods.replacePartitionMemories({
      userId,
      expected,
      entries: [
        { key: 'compact_one', value: 'compacted value', title: 'Compacted', tokenCount: 4 },
      ],
    });

    expect(result.ok).toBe(true);
    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => m.key)).toEqual(['compact_one']);
    expect(personal[0]).toMatchObject({
      value: 'compacted value',
      title: 'Compacted',
      tokenCount: 4,
    });
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.insertedIds).toEqual([personal[0]._id.toString()]);
    expect(result.appliedAt).toBeInstanceOf(Date);
    expect(personal[0].updated_at?.getTime()).toBe(result.appliedAt.getTime());
    expect(await methods.getUserMemories({ userId, agentId })).toHaveLength(1);
  });

  it('refuses without changes when an entry was added after the read', async () => {
    await methods.setMemory({ userId, key: 'stale_one', value: 'stale value 1', tokenCount: 1 });
    const expected = await readExpected();
    await methods.setMemory({
      userId,
      key: 'fresh',
      value: 'written mid-compaction',
      tokenCount: 1,
    });

    const result = await methods.replacePartitionMemories({
      userId,
      expected,
      entries: [{ key: 'compact_one', value: 'compacted value', tokenCount: 4 }],
    });

    expect(result).toEqual({ ok: false, reason: 'changed' });
    expect((await methods.getUserMemories({ userId })).map((m) => m.key).sort()).toEqual([
      'fresh',
      'stale_one',
    ]);
  });

  it('refuses without changes when a read entry was updated or deleted after the read', async () => {
    await methods.setMemory({ userId, key: 'one', value: 'value 1', tokenCount: 1 });
    await methods.setMemory({ userId, key: 'two', value: 'value 2', tokenCount: 1 });
    const expected = await readExpected();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await methods.setMemory({ userId, key: 'one', value: 'value 1 edited', tokenCount: 1 });

    const updated = await methods.replacePartitionMemories({
      userId,
      expected,
      entries: [{ key: 'compact_one', value: 'compacted value', tokenCount: 4 }],
    });
    expect(updated).toEqual({ ok: false, reason: 'changed' });

    const fresh = await readExpected();
    await methods.deleteMemory({ userId, key: 'two' });
    const deleted = await methods.replacePartitionMemories({
      userId,
      expected: fresh,
      entries: [{ key: 'compact_one', value: 'compacted value', tokenCount: 4 }],
    });
    expect(deleted).toEqual({ ok: false, reason: 'changed' });
    expect((await methods.getUserMemories({ userId })).map((m) => m.value)).toEqual([
      'value 1 edited',
    ]);
  });

  it('leaves the partition as it was when the insert fails', async () => {
    await methods.setMemory({ userId, key: 'one', value: 'value 1', tokenCount: 1 });
    const expected = await readExpected();

    await expect(
      methods.replacePartitionMemories({
        userId,
        expected,
        entries: [
          { key: 'good_key', value: 'fine', tokenCount: 1 },
          { key: 'Bad Key 1', value: 'rejected by the schema', tokenCount: 1 },
        ],
      }),
    ).rejects.toThrow('Failed to replace partition memories');

    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => m.key)).toEqual(['one']);
  });

  it('replaces an agent-partition without touching the personal pool', async () => {
    await methods.setMemory({ userId, key: 'personal', value: 'personal value', tokenCount: 1 });
    await methods.setMemory({
      userId,
      key: 'agent_stale',
      value: 'stale agent value',
      tokenCount: 1,
      agentId,
    });

    const result = await methods.replacePartitionMemories({
      userId,
      agentId,
      expected: await readExpected({ agentId }),
      entries: [{ key: 'agent_compact', value: 'compacted agent value', tokenCount: 3 }],
    });

    expect(result.ok).toBe(true);
    expect((await methods.getUserMemories({ userId })).map((m) => m.key)).toEqual(['personal']);
    const agentEntries = await methods.getUserMemories({ userId, agentId });
    expect(agentEntries).toHaveLength(1);
    expect(agentEntries[0]).toMatchObject({ key: 'agent_compact', agentId });
  });
});

describe('restorePartitionMemories', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));

  async function compactPersonal() {
    const expected = (await methods.getUserMemories({ userId })).map((entry) => ({
      _id: entry._id,
      updated_at: entry.updated_at,
    }));
    const result = await methods.replacePartitionMemories({
      userId,
      expected,
      entries: [
        { key: 'role', value: 'compacted role', tokenCount: 2 },
        { key: 'terms', value: 'compacted terms', tokenCount: 2 },
      ],
    });
    if (!result.ok) {
      throw new Error('compaction refused');
    }
    return result;
  }

  it('swaps the compacted entries back for the snapshot, keeping original dates', async () => {
    await methods.setMemory({ userId, key: 'role', value: 'original role', tokenCount: 2 });
    await methods.setMemory({ userId, key: 'terms_a', value: 'terms a', tokenCount: 2 });
    await methods.setMemory({ userId, key: 'terms_b', value: 'terms b', tokenCount: 2 });
    const { insertedIds, appliedAt } = await compactPersonal();

    const result = await methods.restorePartitionMemories({
      userId,
      compactedIds: insertedIds,
      appliedAt,
      entries: [
        { key: 'role', value: 'original role', title: 'Role', tokenCount: 2, updated_at: day(1) },
        { key: 'terms_a', value: 'terms a', tokenCount: 2, updated_at: day(2) },
        { key: 'terms_b', value: 'terms b', tokenCount: 2, updated_at: day(3) },
      ],
    });

    expect(result).toEqual({ restored: 3 });
    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => m.key).sort()).toEqual(['role', 'terms_a', 'terms_b']);
    const role = personal.find((m) => m.key === 'role');
    expect(role).toMatchObject({ value: 'original role', title: 'Role' });
    expect(role?.updated_at?.getTime()).toBe(day(1).getTime());
  });

  it('keeps entries written or edited after the compaction and does not duplicate their keys', async () => {
    await methods.setMemory({ userId, key: 'role', value: 'original role', tokenCount: 2 });
    await methods.setMemory({ userId, key: 'terms_a', value: 'terms a', tokenCount: 2 });
    await methods.setMemory({ userId, key: 'terms_b', value: 'terms b', tokenCount: 2 });
    const { insertedIds, appliedAt } = await compactPersonal();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await methods.setMemory({ userId, key: 'role', value: 'role edited later', tokenCount: 2 });
    await methods.setMemory({ userId, key: 'phone', value: 'new fact', tokenCount: 2 });

    const result = await methods.restorePartitionMemories({
      userId,
      compactedIds: insertedIds,
      appliedAt,
      entries: [
        { key: 'role', value: 'original role', tokenCount: 2, updated_at: day(1) },
        { key: 'terms_a', value: 'terms a', tokenCount: 2, updated_at: day(2) },
        { key: 'terms_b', value: 'terms b', tokenCount: 2, updated_at: day(3) },
      ],
    });

    expect(result).toEqual({ restored: 2 });
    const personal = await methods.getUserMemories({ userId });
    expect(personal.map((m) => `${m.key}=${m.value}`).sort()).toEqual([
      'phone=new fact',
      'role=role edited later',
      'terms_a=terms a',
      'terms_b=terms b',
    ]);
  });

  it('restores entries the schema would now reject', async () => {
    const result = await methods.restorePartitionMemories({
      userId,
      compactedIds: [],
      appliedAt: null,
      entries: [
        { key: 'deadline_2026', value: 'legacy key', tokenCount: 2, updated_at: day(1) },
        { key: 'empty_value', value: '', tokenCount: 0, updated_at: day(2) },
      ],
    });

    expect(result).toEqual({ restored: 2 });
    const personal = await MemoryEntry.find({ userId }).lean();
    expect(personal.map((m) => m.key).sort()).toEqual(['deadline_2026', 'empty_value']);
    expect(personal.every((m) => m.userId instanceof mongoose.Types.ObjectId)).toBe(true);
  });

  it('restores into the snapshot partition only', async () => {
    await methods.setMemory({ userId, key: 'personal', value: 'personal value', tokenCount: 1 });

    await methods.restorePartitionMemories({
      userId,
      agentId,
      compactedIds: [],
      appliedAt: null,
      entries: [{ key: 'personal', value: 'agent value', tokenCount: 1, updated_at: day(1) }],
    });

    expect((await methods.getUserMemories({ userId })).map((m) => m.value)).toEqual([
      'personal value',
    ]);
    expect((await methods.getUserMemories({ userId, agentId })).map((m) => m.value)).toEqual([
      'agent value',
    ]);
  });
});
