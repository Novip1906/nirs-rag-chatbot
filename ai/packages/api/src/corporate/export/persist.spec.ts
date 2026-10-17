import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FileSources, FileContext } from 'librechat-data-provider';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AllMethods } from '@librechat/data-schemas';
import type { SaveBufferParams } from '~/storage/types';
import type { PersistExportDeps } from './persist';
import { persistExportFile } from './persist';
import { parkRenderedExport } from './store';

const CSV_TEXT = 'Город;Сумма\r\nМосква;1234,5\r\n';

let mongoServer: MongoMemoryServer;
let methods: AllMethods;
let uploadsDir: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  uploadsDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'export-uploads-'));
});

afterEach(async () => {
  await fs.promises.rm(uploadsDir, { recursive: true, force: true });
});

function localDeps(): PersistExportDeps {
  return {
    saveBuffer: async ({ userId, buffer, fileName, basePath }: SaveBufferParams) => {
      const directory = path.join(uploadsDir, userId);
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(path.join(directory, fileName), buffer);
      return `/${basePath}/${userId}/${fileName}`;
    },
    createFile: (data, disableTTL) =>
      methods.createFile({ ...data, user: new Types.ObjectId(data.user) }, disableTTL),
  };
}

function parkCsv(): string {
  return parkRenderedExport({
    buffer: Buffer.from(CSV_TEXT, 'utf8'),
    filename: 'Выгрузка.csv',
    mimeType: 'text/csv',
  });
}

describe('persistExportFile', () => {
  it('кладёт файл в хранилище, пишет запись в базу и отдаёт вложение для карточки', async () => {
    const userId = new Types.ObjectId().toString();
    const attachment = await persistExportFile(
      {
        exportId: parkCsv(),
        userId,
        source: FileSources.local,
        conversationId: 'conv-1',
        messageId: 'msg-1',
        toolCallId: 'call-1',
        retention: {},
      },
      localDeps(),
    );
    const fileId = attachment?.file_id ?? '';
    expect(attachment).toMatchObject({
      user: userId,
      filename: 'Выгрузка.csv',
      filepath: `/uploads/${userId}/${fileId}.csv`,
      type: 'text/csv',
      bytes: Buffer.byteLength(CSV_TEXT),
      object: 'file',
      source: FileSources.local,
      context: FileContext.export_file,
      conversationId: 'conv-1',
      messageId: 'msg-1',
      toolCallId: 'call-1',
    });
    expect(await fs.promises.readFile(path.join(uploadsDir, userId, `${fileId}.csv`), 'utf8')).toBe(
      CSV_TEXT,
    );
    const stored = await methods.findFileById(fileId);
    expect(stored).toMatchObject({
      filename: 'Выгрузка.csv',
      type: 'text/csv',
      context: 'export_file',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      source: 'local',
    });
    expect(stored?.user.toString()).toBe(userId);
    expect(stored?.expiresAt).toBeUndefined();
  });

  it('проставляет срок хранения беседы', async () => {
    const expiredAt = new Date('2026-12-31T00:00:00.000Z');
    const attachment = await persistExportFile(
      {
        exportId: parkCsv(),
        userId: new Types.ObjectId().toString(),
        source: FileSources.local,
        toolCallId: 'call-2',
        retention: { expiredAt },
      },
      localDeps(),
    );
    const stored = await methods.findFileById(attachment?.file_id ?? '');
    expect(stored?.expiredAt).toEqual(expiredAt);
  });

  it('ничего не сохраняет, если готовый файл уже забран или устарел', async () => {
    const result = await persistExportFile(
      {
        exportId: 'нет-такого',
        userId: new Types.ObjectId().toString(),
        source: FileSources.local,
        toolCallId: 'call-3',
        retention: {},
      },
      localDeps(),
    );
    expect(result).toBeNull();
    expect(await fs.promises.readdir(uploadsDir)).toEqual([]);
  });

  it('падает понятной ошибкой, если хранилище не умеет сохранять буфер', async () => {
    await expect(
      persistExportFile(
        {
          exportId: parkCsv(),
          userId: new Types.ObjectId().toString(),
          source: FileSources.local,
          toolCallId: 'call-4',
          retention: {},
        },
        { ...localDeps(), saveBuffer: undefined },
      ),
    ).rejects.toThrow('не умеет сохранять файлы выгрузки');
  });
});
