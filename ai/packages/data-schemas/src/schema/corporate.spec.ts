import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createCorporateSettingsModel } from '../models/corporateSettings';
import { createUsageRecordModel } from '../models/usageRecord';
import { createUserPolicyModel } from '../models/userPolicy';
import { createDepartmentModel } from '../models/department';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const models = [
    createDepartmentModel(mongoose),
    createUserPolicyModel(mongoose),
    createUsageRecordModel(mongoose),
    createCorporateSettingsModel(mongoose),
  ];
  await Promise.all(models.map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.Department.deleteMany({}),
    mongoose.models.UserPolicy.deleteMany({}),
    mongoose.models.UsageRecord.deleteMany({}),
    mongoose.models.CorporateSettings.deleteMany({}),
  ]);
});

describe('Corporate AI schemas', () => {
  it('отклоняет второй отдел с тем же именем', async () => {
    const Department = mongoose.models.Department;
    await Department.create({ name: 'Юристы' });
    await expect(Department.create({ name: 'Юристы' })).rejects.toThrow();
  });

  it('подставляет пустые лимиты и пустой список моделей отделу', async () => {
    const Department = mongoose.models.Department;
    const created = await Department.create({ name: 'Поддержка' });
    expect(created.allowedModels).toEqual([]);
    expect(created.defaultLimits.toObject()).toEqual({
      dailyCostUsd: null,
    });
  });

  it('держит не больше одной политики на пользователя', async () => {
    const UserPolicy = mongoose.models.UserPolicy;
    const userId = new mongoose.Types.ObjectId();
    await UserPolicy.create({ userId });
    await expect(UserPolicy.create({ userId })).rejects.toThrow();
  });

  it('помечает расход как unknown, когда провайдер не вернул стоимость', async () => {
    const UsageRecord = mongoose.models.UsageRecord;
    const created = await UsageRecord.create({
      userId: new mongoose.Types.ObjectId(),
      model: 'anthropic/claude-haiku-4.5',
      promptTokens: 10,
      completionTokens: 5,
    });
    expect(created.costUsd).toBe(0);
    expect(created.costSource).toBe('unknown');
  });
  it('подставляет null в defaultModel отделу и глобальным настройкам', async () => {
    const department = await mongoose.models.Department.create({ name: 'Аналитика' });
    const settings = await mongoose.models.CorporateSettings.create({ key: 'global' });

    expect(department.defaultModel).toBeNull();
    expect(settings.defaultModel).toBeNull();
  });

  it('хранит defaultModel в персональной политике', async () => {
    const policy = await mongoose.models.UserPolicy.create({
      userId: new mongoose.Types.ObjectId(),
      allowedModels: ['google/gemini-3.5-flash'],
      defaultModel: 'google/gemini-3.5-flash',
    });

    expect(policy.defaultModel).toBe('google/gemini-3.5-flash');
  });
});
