import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createKnowledgeDocumentModel } from '~/models/knowledgeDocument';
import { createKnowledgeSpaceModel } from '~/models/knowledgeSpace';
import { createKnowledgeMethods, KnowledgeSpaceNotEmptyError } from './knowledge';

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createKnowledgeMethods>;
let userId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const models = [createKnowledgeSpaceModel(mongoose), createKnowledgeDocumentModel(mongoose)];
  await Promise.all(models.map((model) => model.init()));
  methods = createKnowledgeMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.KnowledgeSpace.deleteMany({}),
    mongoose.models.KnowledgeDocument.deleteMany({}),
  ]);
  userId = new mongoose.Types.ObjectId().toString();
});

describe('пространства', () => {
  it('listSpaces возвращает все пространства по имени', async () => {
    await methods.createSpace({ name: 'Продуктовое' });
    await methods.createSpace({ name: 'Административное' });

    const spaces = await methods.listSpaces();

    expect(spaces.map((space) => space.name)).toEqual(['Административное', 'Продуктовое']);
  });

  it('createSpace/getSpaceById возвращают одно и то же пространство', async () => {
    const created = await methods.createSpace({ name: 'Стандарты' });
    const found = await methods.getSpaceById(created._id.toString());
    expect(found?.name).toBe('Стандарты');
  });

  it('updateSpace обновляет одно поле, не трогая остальные', async () => {
    const created = await methods.createSpace({ name: 'Стандарты', description: 'старое' });
    const updated = await methods.updateSpace(created._id.toString(), { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(updated?.description).toBe('старое');
  });

  it('deleteSpace отказывает, пока в пространстве есть документы', async () => {
    const space = await methods.createSpace({ name: 'Юридическое' });
    await methods.createDocument({
      spaceId: space._id.toString(),
      file_id: 'f1',
      title: 'Договор',
      uploadedBy: userId,
    });
    await expect(methods.deleteSpace(space._id.toString())).rejects.toThrow(
      KnowledgeSpaceNotEmptyError,
    );
    await expect(methods.deleteSpace(space._id.toString())).rejects.toMatchObject({
      documentCount: 1,
    });
  });

  it('deleteSpace удаляет пустое пространство', async () => {
    const space = await methods.createSpace({ name: 'Пустое' });
    expect(await methods.deleteSpace(space._id.toString())).toBe(true);
    expect(await methods.getSpaceById(space._id.toString())).toBeNull();
  });

  it('countDocumentsBySpace считает документы одной агрегацией по всем пространствам', async () => {
    const spaceA = await methods.createSpace({ name: 'A' });
    const spaceB = await methods.createSpace({ name: 'B' });
    await methods.createDocument({
      spaceId: spaceA._id.toString(),
      file_id: 'a1',
      title: 'X',
      uploadedBy: userId,
    });
    await methods.createDocument({
      spaceId: spaceA._id.toString(),
      file_id: 'a2',
      title: 'Y',
      uploadedBy: userId,
    });
    await methods.createDocument({
      spaceId: spaceB._id.toString(),
      file_id: 'b1',
      title: 'Z',
      uploadedBy: userId,
    });

    const counts = await methods.countDocumentsBySpace();

    expect(counts.get(spaceA._id.toString())).toBe(2);
    expect(counts.get(spaceB._id.toString())).toBe(1);
  });
});

describe('документы', () => {
  it('listDocuments фильтрует по статусу внутри пространства', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const sid = space._id.toString();
    await methods.createDocument({
      spaceId: sid,
      file_id: 'a',
      title: 'Действующий',
      uploadedBy: userId,
    });
    await methods.createDocument({
      spaceId: sid,
      file_id: 'b',
      title: 'Архив',
      uploadedBy: userId,
      status: 'archived',
    });

    const active = await methods.listDocuments({ spaceId: sid, status: 'active' });

    expect(active.map((doc) => doc.file_id)).toEqual(['a']);
  });

  it('getDocumentById находит документ по id', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const created = await methods.createDocument({
      spaceId: space._id.toString(),
      file_id: 'a',
      title: 'Документ',
      uploadedBy: userId,
    });

    const found = await methods.getDocumentById(created._id.toString());

    expect(found?.file_id).toBe('a');
  });

  it('findActiveDocuments не отдаёт архивные и черновики', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const sid = space._id.toString();
    await methods.createDocument({
      spaceId: sid,
      file_id: 'a',
      title: 'Действующий',
      uploadedBy: userId,
    });
    await methods.createDocument({
      spaceId: sid,
      file_id: 'b',
      title: 'Архив',
      uploadedBy: userId,
      status: 'archived',
    });
    await methods.createDocument({
      spaceId: sid,
      file_id: 'c',
      title: 'Черновик',
      uploadedBy: userId,
      status: 'draft',
    });

    const found = await methods.findActiveDocuments([sid]);

    expect(found.map((d) => d.file_id)).toEqual(['a']);
  });

  it('findActiveDocuments по пустому списку пространств не читает базу', async () => {
    const findSpy = jest.spyOn(mongoose.models.KnowledgeDocument, 'find');

    expect(await methods.findActiveDocuments([])).toEqual([]);

    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });

  it('updateDocument обновляет поле, не трогая остальные', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const created = await methods.createDocument({
      spaceId: space._id.toString(),
      file_id: 'a',
      title: 'Старое название',
      owner: 'Иванов',
      uploadedBy: userId,
    });

    const updated = await methods.updateDocument(created._id.toString(), {
      title: 'Новое название',
    });

    expect(updated?.title).toBe('Новое название');
    expect(updated?.owner).toBe('Иванов');
  });

  it('deleteDocument удаляет запись', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const created = await methods.createDocument({
      spaceId: space._id.toString(),
      file_id: 'a',
      title: 'Документ',
      uploadedBy: userId,
    });

    expect(await methods.deleteDocument(created._id.toString())).toBe(true);
    expect(await methods.getDocumentById(created._id.toString())).toBeNull();
  });

  it('archiveDocument переводит в архив, не удаляя запись', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const created = await methods.createDocument({
      spaceId: space._id.toString(),
      file_id: 'a',
      title: 'Документ',
      uploadedBy: userId,
    });

    const archived = await methods.archiveDocument(created._id.toString());

    expect(archived?.status).toBe('archived');
    expect(await methods.getDocumentById(created._id.toString())).not.toBeNull();
  });

  it('lexicalSearch ранжирует и режет по переданным file_ids', async () => {
    const space = await methods.createSpace({ name: 'Стандарты' });
    const sid = space._id.toString();
    await methods.createDocument({
      spaceId: sid,
      file_id: 'prikaz',
      title: 'Приказ № 47-П о расходах',
      uploadedBy: userId,
    });
    await methods.createDocument({
      spaceId: sid,
      file_id: 'other',
      title: 'Инструкция по эквайрингу',
      uploadedBy: userId,
    });
    await mongoose.models.KnowledgeDocument.syncIndexes();

    expect(
      await methods.lexicalSearch({ fileIds: ['prikaz', 'other'], query: '47-П', limit: 10 }),
    ).toEqual(['prikaz']);
    expect(await methods.lexicalSearch({ fileIds: ['other'], query: '47-П', limit: 10 })).toEqual(
      [],
    );
  });

  it('lexicalSearch по пустому списку file_ids или пустому запросу не ходит в базу', async () => {
    const findSpy = jest.spyOn(mongoose.models.KnowledgeDocument, 'find');

    expect(await methods.lexicalSearch({ fileIds: [], query: 'что-то', limit: 10 })).toEqual([]);
    expect(await methods.lexicalSearch({ fileIds: ['a'], query: '  ', limit: 10 })).toEqual([]);

    expect(findSpy).not.toHaveBeenCalled();
    findSpy.mockRestore();
  });
});
