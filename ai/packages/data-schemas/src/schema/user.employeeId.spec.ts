import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUserModel } from '~/models/user';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createUserModel(mongoose).init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.User.deleteMany({});
});

describe('employeeId', () => {
  it('сохраняется как строка', async () => {
    const User = mongoose.models.User;
    const user = await User.create({
      email: 'ivanov@example.com',
      emailVerified: true,
      provider: 'local',
      employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    });
    expect(user.employeeId).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  });

  it('не допускает двух сотрудников с одним идентификатором', async () => {
    const User = mongoose.models.User;
    await User.create({
      email: 'first@example.com',
      emailVerified: true,
      provider: 'local',
      employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    });
    await expect(
      User.create({
        email: 'second@example.com',
        emailVerified: true,
        provider: 'local',
        employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      }),
    ).rejects.toThrow();
  });

  it('допускает несколько записей без идентификатора', async () => {
    const User = mongoose.models.User;
    await User.create({ email: 'a@example.com', emailVerified: true, provider: 'local' });
    await expect(
      User.create({ email: 'b@example.com', emailVerified: true, provider: 'local' }),
    ).resolves.toBeDefined();
  });
});
