import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createFileModel } from '../models/file';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await createFileModel(mongoose).init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('file.tokenCount', () => {
  it('сохраняет объём документа в токенах', async () => {
    const created = await mongoose.models.File.create({
      user: new mongoose.Types.ObjectId().toString(),
      file_id: 'file-1',
      filename: 'regulation.docx',
      filepath: '/uploads/regulation.docx',
      object: 'file',
      type: 'text/plain',
      bytes: 1024,
      tokenCount: 12345,
    });

    expect(created.tokenCount).toBe(12345);
  });

  /** У PDF страницы посчитаны по-настоящему и хранятся рядом с объёмом. */
  it('сохраняет число страниц PDF рядом с объёмом', async () => {
    const created = await mongoose.models.File.create({
      user: new mongoose.Types.ObjectId().toString(),
      file_id: 'file-3',
      filename: 'contract.pdf',
      filepath: '/uploads/contract.pdf',
      object: 'file',
      type: 'application/pdf',
      bytes: 4096,
      tokenCount: 103200,
      pageCount: 400,
    });

    expect(created.pageCount).toBe(400);
  });

  /** Все файлы, загруженные до этой задачи, живут без поля — читать их надо без падений. */
  it('допускает отсутствие поля у старых записей', async () => {
    const created = await mongoose.models.File.create({
      user: new mongoose.Types.ObjectId().toString(),
      file_id: 'file-2',
      filename: 'photo.png',
      filepath: '/uploads/photo.png',
      object: 'file',
      type: 'image/png',
      bytes: 2048,
    });

    expect(created.tokenCount).toBeUndefined();
  });
});
