import mongoose from 'mongoose';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels } from '@librechat/data-schemas';
import type { IProjectDocument } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';
import { buildProjectDocumentContext } from './deps';

let mongod: MongoMemoryServer;

const owner = '65f0000000000000000000aa';
const projectId = new Types.ObjectId().toString();

function projectDocumentModel(): mongoose.Model<IProjectDocument> {
  return mongoose.models.ProjectDocument as mongoose.Model<IProjectDocument>;
}

function requestWith(body: ServerRequest['body']): ServerRequest {
  return {
    user: { id: owner },
    body,
  } as unknown as ServerRequest;
}

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  mongod = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await projectDocumentModel().deleteMany({});
  await projectDocumentModel().create({
    owner,
    projectId: new Types.ObjectId(projectId),
    entityId: `proj_${projectId}`,
    file_id: 'doc-1',
    title: 'Тарифы эквайринга',
    filename: 'tariffs.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: 1024,
    text: 'Ставка эквайринга — 1,8 процента.',
    tokenCount: 20,
    embedded: true,
    storagePath: '/tmp/doc-1.docx',
  });
});

describe('buildProjectDocumentContext', () => {
  /**
   * Главный сценарий фичи: сотрудник открывает проект и задаёт первый вопрос.
   * Разговора в Mongo ещё нет, `req.resolvedConversation` пуст, и единственный
   * источник привязки — тело запроса.
   */
  it('собирает контекст для первого сообщения нового чата по chatProjectId из тела', async () => {
    const context = await buildProjectDocumentContext(
      requestWith({ chatProjectId: projectId, text: 'что там по ставке эквайринга' }),
    );

    expect(context).toContain('Тарифы эквайринга');
    expect(context).toContain('Ставка эквайринга — 1,8 процента.');
  });

  it('предпочитает привязку разговора телу запроса', async () => {
    const request = requestWith({ chatProjectId: projectId, text: 'ставка' });
    request.resolvedConversation = { chatProjectId: new Types.ObjectId().toString() };

    expect(await buildProjectDocumentContext(request)).toBeNull();
  });

  it('не отдаёт документы чужого проекта', async () => {
    const context = await buildProjectDocumentContext(
      requestWith({ chatProjectId: new Types.ObjectId().toString(), text: 'ставка' }),
    );

    expect(context).toBeNull();
  });

  it('без привязки к проекту контекста нет', async () => {
    expect(await buildProjectDocumentContext(requestWith({ text: 'ставка' }))).toBeNull();
  });

  /**
   * Временный сбой Mongo не должен ронять ответ целиком: без документов чат
   * отвечает хуже, но отвечает.
   */
  it('возвращает null, когда чтение документов упало', async () => {
    const find = jest.spyOn(projectDocumentModel(), 'find').mockImplementation(() => {
      throw new Error('replica set election');
    });

    expect(
      await buildProjectDocumentContext(requestWith({ chatProjectId: projectId, text: 'ставка' })),
    ).toBeNull();

    find.mockRestore();
  });
});
