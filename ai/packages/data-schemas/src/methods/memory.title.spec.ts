import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IMemoryEntry, IChatProjectDocument } from '~/types';
import { createMemoryMethods, type MemoryMethods } from './memory';
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
const agentId = 'agent_partition_a';

let chatProjectId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  MemoryEntry = mongoose.models.MemoryEntry as mongoose.Model<IMemoryEntry>;
  ChatProject = mongoose.models.ChatProject as mongoose.Model<IChatProjectDocument>;
  methods = createMemoryMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());

  const project = await ChatProject.create({ name: 'Project A', user: userId.toString() });
  chatProjectId = project._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await MemoryEntry.deleteMany({});
});

describe('memory title and key derivation', () => {
  it('derives a key from the title when no key is given', async () => {
    const result = await methods.createMemory({ userId, title: 'Город', value: 'some value' });
    expect(result).toMatchObject({ ok: true, key: 'gorod', title: 'Город' });
    const stored = await MemoryEntry.findOne({ userId, key: 'gorod' }).lean();
    expect(stored?.title).toBe('Город');
  });

  it('scopes the collision suffix to the partition', async () => {
    await methods.createMemory({ userId, title: 'Город', value: 'first' });
    const collided = await methods.createMemory({ userId, title: 'Город', value: 'second' });
    expect(collided).toMatchObject({ ok: true, key: 'gorod_b' });

    const agentScoped = await methods.createMemory({
      userId,
      title: 'Город',
      value: 'agent scoped',
      agentId,
    });
    expect(agentScoped).toMatchObject({ ok: true, key: 'gorod' });

    const projectScoped = await methods.createMemory({
      userId,
      title: 'Город',
      value: 'project scoped',
      chatProjectId,
    });
    expect(projectScoped).toMatchObject({ ok: true, key: 'gorod' });
  });

  it('derives a key from the value when no title is given', async () => {
    const result = await methods.createMemory({ userId, value: 'Город' });
    expect(result).toMatchObject({ ok: true, key: 'gorod' });
  });

  it('keeps an explicit key and stores the title alongside it', async () => {
    const result = await methods.createMemory({
      userId,
      key: 'custom_key',
      title: 'Custom title',
      value: 'some value',
    });
    expect(result).toMatchObject({ ok: true, key: 'custom_key', title: 'Custom title' });
    const stored = await MemoryEntry.findOne({ userId, key: 'custom_key' }).lean();
    expect(stored?.title).toBe('Custom title');
  });

  it('overwrites the title on setMemory only when a non-empty title is given', async () => {
    await methods.createMemory({ userId, key: 'context', title: 'Original', value: 'v1' });

    await methods.setMemory({ userId, key: 'context', value: 'v2' });
    let stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.title).toBe('Original');

    await methods.setMemory({ userId, key: 'context', value: 'v3', title: 'Updated' });
    stored = await MemoryEntry.findOne({ userId, key: 'context' }).lean();
    expect(stored?.title).toBe('Updated');
  });

  it('changes the title via setMemoryById without touching the key', async () => {
    await methods.createMemory({ userId, key: 'context', title: 'Original', value: 'v1' });
    const [stored] = await methods.getUserMemories({ userId });

    const result = await methods.setMemoryById({
      userId,
      id: stored._id.toString(),
      value: 'v2',
      title: 'Renamed',
    });

    expect(result).toMatchObject({ ok: true, memory: { key: 'context', title: 'Renamed' } });
  });

  it('returns the title of the deleted memory', async () => {
    await methods.createMemory({ userId, key: 'context', title: 'Original', value: 'v1' });
    const result = await methods.deleteMemory({ userId, key: 'context' });
    expect(result).toMatchObject({ ok: true, title: 'Original' });
  });

  it('includes a bracketed title fragment only for entries that have one', async () => {
    await methods.createMemory({ userId, key: 'titled', title: 'Has Title', value: 'v1' });
    await methods.createMemory({ userId, key: 'untitled', value: 'v2' });

    const formatted = await methods.getFormattedMemories({ userId });
    expect(formatted.withKeys).toContain('Has Title');
    expect(formatted.withoutKeys).toContain('Has Title');
    expect(formatted.withKeys).not.toContain('"title": "undefined"');
  });
});
