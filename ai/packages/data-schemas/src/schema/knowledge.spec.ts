import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createKnowledgeSpaceModel } from '~/models/knowledgeSpace';
import { createKnowledgeDocumentModel } from '~/models/knowledgeDocument';
import { createUserPolicyModel } from '~/models/userPolicy';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const models = [
    createKnowledgeSpaceModel(mongoose),
    createKnowledgeDocumentModel(mongoose),
    createUserPolicyModel(mongoose),
  ];
  await Promise.all(models.map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.KnowledgeSpace.deleteMany({}),
    mongoose.models.KnowledgeDocument.deleteMany({}),
    mongoose.models.UserPolicy.deleteMany({}),
  ]);
});

describe('knowledgeSpace', () => {
  it('требует имя и по умолчанию доступно всем отделам', async () => {
    const KnowledgeSpace = mongoose.models.KnowledgeSpace;
    const space = await KnowledgeSpace.create({ name: 'Корпоративные стандарты' });
    expect(space.allowedDepartments).toEqual([]);
    expect(space.enabled).toBe(true);
    expect(space.embeddingModel).toBe('baai/bge-m3');
    await expect(KnowledgeSpace.create({})).rejects.toThrow();
  });

  it('не допускает два пространства с одним именем', async () => {
    const KnowledgeSpace = mongoose.models.KnowledgeSpace;
    await KnowledgeSpace.create({ name: 'Продуктовое' });
    await expect(KnowledgeSpace.create({ name: 'Продуктовое' })).rejects.toThrow();
  });
});

describe('knowledgeDocument', () => {
  it('по умолчанию действующий', async () => {
    const KnowledgeDocument = mongoose.models.KnowledgeDocument;
    const doc = await KnowledgeDocument.create({
      spaceId: new Types.ObjectId(),
      file_id: 'f1',
      title: 'Регламент',
      uploadedBy: new Types.ObjectId(),
    });
    expect(doc.status).toBe('active');
    expect(doc.supersedesId).toBeNull();
  });

  it('отвергает неизвестный статус', async () => {
    const KnowledgeDocument = mongoose.models.KnowledgeDocument;
    await expect(
      KnowledgeDocument.create({
        spaceId: new Types.ObjectId(),
        file_id: 'f2',
        title: 'X',
        uploadedBy: new Types.ObjectId(),
        status: 'неизвестно',
      }),
    ).rejects.toThrow();
  });

  it('находит документ русским текстовым поиском по номеру и по слову', async () => {
    const KnowledgeDocument = mongoose.models.KnowledgeDocument;
    await KnowledgeDocument.create({
      spaceId: new Types.ObjectId(),
      file_id: 'f3',
      uploadedBy: new Types.ObjectId(),
      title: 'Приказ № 47-П о согласовании расходов',
      text: 'Расходы на подрядчиков согласует финансовый директор.',
    });
    await KnowledgeDocument.syncIndexes();
    const byNumber = await KnowledgeDocument.find({ $text: { $search: '47-П' } });
    expect(byNumber).toHaveLength(1);
    const byWord = await KnowledgeDocument.find({ $text: { $search: 'подрядчиков' } });
    expect(byWord).toHaveLength(1);
  });
});

describe('userPolicy', () => {
  it('по умолчанию не добавляет и не отнимает пространств', async () => {
    const UserPolicy = mongoose.models.UserPolicy;
    const policy = await UserPolicy.create({ userId: new Types.ObjectId() });
    expect(policy.allowedSpaces).toEqual([]);
    expect(policy.deniedSpaces).toEqual([]);
  });
});
