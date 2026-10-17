import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type * as t from '~/types';
import { createUserMethods } from './user';
import balanceSchema from '~/schema/balance';
import userSchema from '~/schema/user';

let mongoServer: MongoMemoryServer;
let User: mongoose.Model<t.IUser>;
let methods: ReturnType<typeof createUserMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  User = mongoose.models.User || mongoose.model<t.IUser>('User', userSchema);
  mongoose.models.Balance || mongoose.model<t.IBalance>('Balance', balanceSchema);

  methods = createUserMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

describe('createUser', () => {
  it('присваивает employeeId новому сотруднику', async () => {
    const created = await methods.createUser(
      { email: 'ivanov@example.com', emailVerified: true, provider: 'local' },
      undefined,
      true,
      true,
    );
    const user = await User.findById((created as { _id: unknown })._id).lean();
    expect(user?.employeeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('не перетирает переданный employeeId', async () => {
    const created = await methods.createUser(
      {
        email: 'petrov@example.com',
        emailVerified: true,
        provider: 'local',
        employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      },
      undefined,
      true,
      true,
    );
    const user = await User.findById((created as { _id: unknown })._id).lean();
    expect(user?.employeeId).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  });
});
