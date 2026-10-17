import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { backfillEmployeeIds } from './employeeIds';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('users').deleteMany({});
});

describe('backfillEmployeeIds', () => {
  it('проставляет идентификатор всем, у кого его нет', async () => {
    const users = mongoose.connection.collection('users');
    await users.insertMany([
      { email: 'a@example.com', provider: 'local' },
      { email: 'b@example.com', provider: 'local' },
    ]);

    await expect(backfillEmployeeIds(mongoose.connection)).resolves.toEqual({
      scanned: 2,
      updated: 2,
    });

    const rows = await users.find({}).toArray();
    const ids = rows.map((row) => row.employeeId);
    expect(ids.every((id) => typeof id === 'string' && id.length === 36)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('не трогает тех, у кого идентификатор уже есть', async () => {
    const users = mongoose.connection.collection('users');
    await users.insertOne({
      email: 'a@example.com',
      provider: 'local',
      employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    });

    await expect(backfillEmployeeIds(mongoose.connection)).resolves.toEqual({
      scanned: 0,
      updated: 0,
    });

    const row = await users.findOne({ email: 'a@example.com' });
    expect(row?.employeeId).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  });

  it('в режиме проверки ничего не пишет', async () => {
    const users = mongoose.connection.collection('users');
    await users.insertOne({ email: 'a@example.com', provider: 'local' });

    await expect(backfillEmployeeIds(mongoose.connection, { dryRun: true })).resolves.toEqual({
      scanned: 1,
      updated: 0,
    });

    const row = await users.findOne({ email: 'a@example.com' });
    expect(row?.employeeId).toBeUndefined();
  });
});
