import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IMemorySnapshot } from '~/types';
import { createMemorySnapshotMethods, type MemorySnapshotMethods } from './memorySnapshot';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let MemorySnapshot: mongoose.Model<IMemorySnapshot>;
let methods: MemorySnapshotMethods;

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const agentId = 'agent_partition_a';

const entries = [
  {
    key: 'context',
    value: 'likes tea',
    title: 'Preference',
    tokenCount: 3,
    updated_at: new Date(),
  },
  { key: 'role', value: 'engineer', tokenCount: 2, updated_at: new Date() },
];

const appliedAt = new Date(Date.UTC(2026, 8, 25, 10));

function done(after: number) {
  return { after, appliedAt, compactedIds: [new mongoose.Types.ObjectId().toString()] };
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  MemorySnapshot = mongoose.models.MemorySnapshot as mongoose.Model<IMemorySnapshot>;
  methods = createMemorySnapshotMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await MemorySnapshot.deleteMany({});
});

describe('TTL index', () => {
  it('declares a 30-day expiry on createdAt', () => {
    const indexes = MemorySnapshot.schema.indexes() as Array<
      [Record<string, number>, { expireAfterSeconds?: number }]
    >;
    const ttlIndex = indexes.find(([, options]) => options?.expireAfterSeconds != null);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.[0]).toEqual({ createdAt: 1 });
    expect(ttlIndex?.[1].expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe('createMemorySnapshot / getMemorySnapshot', () => {
  it('stores the given entries and derives before from their count', async () => {
    const { id } = await methods.createMemorySnapshot({
      userId,
      entries,
      reason: 'manual',
    });

    const snapshot = await methods.getMemorySnapshot({ userId, snapshotId: id });
    expect(snapshot).toMatchObject({
      before: 2,
      after: null,
      reason: 'manual',
      agentId: null,
      chatProjectId: null,
    });
    expect(snapshot?.entries).toEqual(entries);
  });

  it('accepts entries with an empty value', async () => {
    const { id } = await methods.createMemorySnapshot({
      userId,
      entries: [{ key: 'blank', value: '', tokenCount: 0, updated_at: new Date() }],
      reason: 'manual',
    });

    const snapshot = await methods.getMemorySnapshot({ userId, snapshotId: id });
    expect(snapshot?.entries).toHaveLength(1);
  });

  it('scopes agentId/chatProjectId on the snapshot to the partition it was taken from', async () => {
    const { id } = await methods.createMemorySnapshot({
      userId,
      agentId,
      entries,
      reason: 'auto',
    });

    const snapshot = await methods.getMemorySnapshot({ userId, snapshotId: id });
    expect(snapshot?.agentId).toBe(agentId);
    expect(snapshot?.chatProjectId).toBeNull();
  });

  it('returns null for a snapshot owned by another user', async () => {
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });

    const snapshot = await methods.getMemorySnapshot({ userId: otherUserId, snapshotId: id });
    expect(snapshot).toBeNull();
  });

  it('returns null for a malformed snapshot id instead of throwing', async () => {
    await expect(
      methods.getMemorySnapshot({ userId, snapshotId: 'not-an-object-id' }),
    ).resolves.toBeNull();
  });

  it('returns null for a well-formed id that does not exist', async () => {
    const snapshotId = new mongoose.Types.ObjectId().toString();
    await expect(methods.getMemorySnapshot({ userId, snapshotId })).resolves.toBeNull();
  });
});

describe('completeMemorySnapshot', () => {
  it('stamps the after count, apply time and compacted ids once compaction finishes', async () => {
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    const completion = done(1);

    await methods.completeMemorySnapshot({ userId, snapshotId: id, ...completion });

    const snapshot = await methods.getMemorySnapshot({ userId, snapshotId: id });
    expect(snapshot?.after).toBe(1);
    expect(snapshot?.appliedAt?.getTime()).toBe(appliedAt.getTime());
    expect(snapshot?.compactedIds).toEqual(completion.compactedIds);
  });

  it('keeps only the newest completed snapshot of a partition', async () => {
    const older = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    await methods.completeMemorySnapshot({ userId, snapshotId: older.id, ...done(1) });
    const otherPartition = await methods.createMemorySnapshot({
      userId,
      agentId,
      entries,
      reason: 'auto',
    });
    await methods.completeMemorySnapshot({ userId, snapshotId: otherPartition.id, ...done(1) });
    const othersSnapshot = await methods.createMemorySnapshot({
      userId: otherUserId,
      entries,
      reason: 'manual',
    });

    const newer = await methods.createMemorySnapshot({ userId, entries, reason: 'auto' });
    await methods.completeMemorySnapshot({ userId, snapshotId: newer.id, ...done(1) });

    expect(await methods.getMemorySnapshot({ userId, snapshotId: older.id })).toBeNull();
    expect(await methods.getMemorySnapshot({ userId, snapshotId: newer.id })).not.toBeNull();
    expect(
      await methods.getMemorySnapshot({ userId, snapshotId: otherPartition.id }),
    ).not.toBeNull();
    expect(
      await methods.getMemorySnapshot({ userId: otherUserId, snapshotId: othersSnapshot.id }),
    ).not.toBeNull();
  });

  it('does not complete a snapshot owned by another user', async () => {
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });

    await methods.completeMemorySnapshot({ userId: otherUserId, snapshotId: id, ...done(1) });

    const snapshot = await methods.getMemorySnapshot({ userId, snapshotId: id });
    expect(snapshot?.after).toBeNull();
  });

  it('is a no-op for a malformed snapshot id', async () => {
    await expect(
      methods.completeMemorySnapshot({ userId, snapshotId: 'not-an-object-id', ...done(1) }),
    ).resolves.toBeUndefined();
  });
});

describe('getRecentMemorySnapshots', () => {
  it('only returns completed snapshots (after != null), newest first', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    const first = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    await methods.completeMemorySnapshot({ userId, snapshotId: first.id, ...done(1) });

    const second = await methods.createMemorySnapshot({
      userId,
      agentId,
      entries: entries.slice(0, 1),
      reason: 'auto',
    });
    await methods.completeMemorySnapshot({ userId, snapshotId: second.id, ...done(1) });

    await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });

    const recent = await methods.getRecentMemorySnapshots({ userId, since });

    expect(recent.map((s) => s.snapshotId)).toEqual([second.id, first.id]);
    expect(recent[0]).toMatchObject({
      agentId,
      chatProjectId: null,
      before: 1,
      after: 1,
      reason: 'auto',
    });
  });

  it('does not load snapshot entries', async () => {
    const findSpy = jest.spyOn(MemorySnapshot, 'find');
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    await methods.completeMemorySnapshot({ userId, snapshotId: id, ...done(1) });

    const recent = await methods.getRecentMemorySnapshots({
      userId,
      since: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(recent).toHaveLength(1);
    expect(recent[0]).not.toHaveProperty('entries');
    const query = findSpy.mock.results[0]?.value as mongoose.Query<unknown, unknown>;
    expect(query.projection()).toMatchObject({ entries: 0 });
    findSpy.mockRestore();
  });

  it('excludes snapshots created before `since`', async () => {
    const stale = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    await methods.completeMemorySnapshot({ userId, snapshotId: stale.id, ...done(1) });
    await MemorySnapshot.updateOne(
      { _id: stale.id },
      { $set: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    );

    const recent = await methods.getRecentMemorySnapshots({
      userId,
      since: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(recent).toHaveLength(0);
  });

  it('scopes results to the requesting user', async () => {
    const mine = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });
    await methods.completeMemorySnapshot({ userId, snapshotId: mine.id, ...done(1) });
    const theirs = await methods.createMemorySnapshot({
      userId: otherUserId,
      entries,
      reason: 'manual',
    });
    await methods.completeMemorySnapshot({
      userId: otherUserId,
      snapshotId: theirs.id,
      ...done(1),
    });

    const recent = await methods.getRecentMemorySnapshots({
      userId,
      since: new Date(Date.now() - 60 * 60 * 1000),
    });

    expect(recent.map((s) => s.snapshotId)).toEqual([mine.id]);
  });
});

describe('deleteMemorySnapshot', () => {
  it('deletes a snapshot owned by the user', async () => {
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });

    await methods.deleteMemorySnapshot({ userId, snapshotId: id });

    expect(await methods.getMemorySnapshot({ userId, snapshotId: id })).toBeNull();
  });

  it('does not delete a snapshot owned by another user', async () => {
    const { id } = await methods.createMemorySnapshot({ userId, entries, reason: 'manual' });

    await methods.deleteMemorySnapshot({ userId: otherUserId, snapshotId: id });

    expect(await methods.getMemorySnapshot({ userId, snapshotId: id })).not.toBeNull();
  });

  it('is a no-op for a malformed snapshot id', async () => {
    await expect(
      methods.deleteMemorySnapshot({ userId, snapshotId: 'not-an-object-id' }),
    ).resolves.toBeUndefined();
  });
});
