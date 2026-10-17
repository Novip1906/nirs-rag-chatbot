import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createProjectDocumentModel } from '../models/projectDocument';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createProjectDocumentModel(mongoose).init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.ProjectDocument.deleteMany({});
});

const owner = new mongoose.Types.ObjectId().toString();
const projectId = new mongoose.Types.ObjectId();

function seed(overrides: Record<string, unknown> = {}) {
  return {
    owner,
    projectId,
    entityId: `proj_${projectId.toString()}`,
    file_id: 'doc-1',
    title: 'Регламент',
    filename: 'reglament.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: 2048,
    text: 'Порядок согласования расходов',
    tokenCount: 12,
    storagePath: '/uploads/knowledge/projects/x/doc-1.docx',
    ...overrides,
  };
}

describe('projectDocument', () => {
  it('сохраняет документ проекта со всеми полями', async () => {
    const created = await mongoose.models.ProjectDocument.create(seed());

    expect(created.owner).toBe(owner);
    expect(created.entityId).toBe(`proj_${projectId.toString()}`);
    expect(created.status).toBe('active');
    expect(created.embedded).toBe(false);
  });

  /** `file_id` — ключ документа в rag_api; два документа с одним ключом означали бы,
   *  что удаление одного вынесет векторы другого. */
  it('не допускает двух документов с одним file_id', async () => {
    await mongoose.models.ProjectDocument.create(seed());

    await expect(mongoose.models.ProjectDocument.create(seed({ title: 'Другой' }))).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('требует владельца и проект', async () => {
    await expect(
      mongoose.models.ProjectDocument.create(seed({ owner: undefined })),
    ).rejects.toThrow();
    await expect(
      mongoose.models.ProjectDocument.create(seed({ projectId: undefined })),
    ).rejects.toThrow();
  });

  /** Лексическая ветка гибридного поиска ходит текстовым индексом по названию и телу. */
  it('находит документ полнотекстовым поиском по названию и телу', async () => {
    await mongoose.models.ProjectDocument.create(seed());

    const byTitle = await mongoose.models.ProjectDocument.find({
      $text: { $search: 'регламент' },
    }).lean();
    const byBody = await mongoose.models.ProjectDocument.find({
      $text: { $search: 'согласования' },
    }).lean();

    expect(byTitle).toHaveLength(1);
    expect(byBody).toHaveLength(1);
  });
});
