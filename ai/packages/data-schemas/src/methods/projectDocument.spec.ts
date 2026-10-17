import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createProjectDocumentModel } from '../models/projectDocument';
import { createProjectDocumentMethods } from './projectDocument';

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createProjectDocumentMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createProjectDocumentModel(mongoose).init();
  methods = createProjectDocumentMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.ProjectDocument.deleteMany({});
});

const owner = new mongoose.Types.ObjectId().toString();
const stranger = new mongoose.Types.ObjectId().toString();
const projectId = new mongoose.Types.ObjectId();

function input(overrides: Partial<Parameters<typeof methods.createProjectDocument>[0]> = {}) {
  return {
    owner,
    projectId,
    entityId: `proj_${projectId.toString()}`,
    file_id: 'doc-1',
    title: 'Регламент командировок',
    filename: 'trip.docx',
    mimetype: 'application/msword',
    bytes: 1024,
    text: 'Командировка оформляется приказом руководителя',
    tokenCount: 20,
    embedded: true,
    storagePath: '/tmp/doc-1.docx',
    ...overrides,
  };
}

describe('createProjectDocument', () => {
  it('создаёт активный документ', async () => {
    const created = await methods.createProjectDocument(input());

    expect(created.status).toBe('active');
    expect(created.file_id).toBe('doc-1');
  });
});

describe('listProjectDocuments', () => {
  it('отдаёт документы своего проекта', async () => {
    await methods.createProjectDocument(input());

    expect(await methods.listProjectDocuments(owner, projectId.toString())).toHaveLength(1);
  });

  /** Проекты персональные: чужой документ не должен находиться даже по верному projectId. */
  it('не отдаёт документы чужого владельца', async () => {
    await methods.createProjectDocument(input());

    expect(await methods.listProjectDocuments(stranger, projectId.toString())).toHaveLength(0);
  });

  it('не отдаёт удалённые документы', async () => {
    await methods.createProjectDocument(input());
    await methods.deleteProjectDocument(owner, 'doc-1');

    expect(await methods.listProjectDocuments(owner, projectId.toString())).toHaveLength(0);
  });

  it('переживает неверный формат projectId без исключения', async () => {
    expect(await methods.listProjectDocuments(owner, 'not-an-object-id')).toEqual([]);
  });
});

describe('deleteProjectDocument', () => {
  /** Вызывающая сторона удаляет векторы по возвращённым `file_id` и `entityId`. */
  it('возвращает удалённый документ, чтобы можно было снять векторы', async () => {
    await methods.createProjectDocument(input());

    const deleted = await methods.deleteProjectDocument(owner, 'doc-1');

    expect(deleted?.file_id).toBe('doc-1');
    expect(deleted?.entityId).toBe(`proj_${projectId.toString()}`);
  });

  it('не удаляет чужой документ', async () => {
    await methods.createProjectDocument(input());

    expect(await methods.deleteProjectDocument(stranger, 'doc-1')).toBeNull();
    expect(await methods.listProjectDocuments(owner, projectId.toString())).toHaveLength(1);
  });
});

describe('квоты', () => {
  it('считает документы проекта', async () => {
    await methods.createProjectDocument(input());
    await methods.createProjectDocument(input({ file_id: 'doc-2' }));

    expect(await methods.countProjectDocuments(owner, projectId.toString())).toBe(2);
  });

  it('суммирует занятое сотрудником место по всем проектам', async () => {
    const other = new mongoose.Types.ObjectId();
    await methods.createProjectDocument(input({ bytes: 1000 }));
    await methods.createProjectDocument({
      ...input({ file_id: 'doc-2', bytes: 2500 }),
      projectId: other,
      entityId: `proj_${other.toString()}`,
    });

    expect(await methods.sumProjectDocumentBytes(owner)).toBe(3500);
  });

  it('отдаёт ноль, когда документов нет', async () => {
    expect(await methods.sumProjectDocumentBytes(owner)).toBe(0);
  });
});

describe('lexicalSearchProjectDocuments', () => {
  it('находит документ по словам из тела и отдаёт только file_id', async () => {
    await methods.createProjectDocument(input());

    const found = await methods.lexicalSearchProjectDocuments({
      fileIds: ['doc-1'],
      query: 'командировка приказ',
      limit: 10,
    });

    expect(found).toEqual(['doc-1']);
  });

  /** Поиск обязан оставаться в пределах переданного списка: он и есть проверка прав. */
  it('не выходит за пределы переданных file_id', async () => {
    await methods.createProjectDocument(input());

    const found = await methods.lexicalSearchProjectDocuments({
      fileIds: ['doc-999'],
      query: 'командировка',
      limit: 10,
    });

    expect(found).toEqual([]);
  });

  it('возвращает пустой список на пустом наборе', async () => {
    expect(
      await methods.lexicalSearchProjectDocuments({ fileIds: [], query: 'что угодно', limit: 10 }),
    ).toEqual([]);
  });
});
