import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createModels } from '@librechat/data-schemas';
import type { IKnowledgeDocument } from '@librechat/data-schemas';
import { migrateKnowledgeFilesToObjectStorage } from './migrate';

const s3Mock = mockClient(S3Client);

let mongod: MongoMemoryServer;
let tempDir: string;
let originalEnv: NodeJS.ProcessEnv;

function knowledgeDocumentModel(): mongoose.Model<IKnowledgeDocument> {
  return mongoose.models.KnowledgeDocument as mongoose.Model<IKnowledgeDocument>;
}

async function createDoc(overrides: Partial<IKnowledgeDocument> = {}) {
  return knowledgeDocumentModel().create({
    spaceId: new mongoose.Types.ObjectId(),
    file_id: `file-${new mongoose.Types.ObjectId().toString()}`,
    title: 'Регламент',
    filename: 'reglament.pdf',
    storagePath: '',
    uploadedBy: new mongoose.Types.ObjectId(),
    ...overrides,
  });
}

beforeAll(async () => {
  originalEnv = { ...process.env };
  mongod = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongod.getUri());
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'knowledge-migrate-'));
});

afterAll(async () => {
  process.env = originalEnv;
  await mongoose.disconnect();
  await mongod.stop();
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await knowledgeDocumentModel().deleteMany({});
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  process.env.KNOWLEDGE_S3_ENDPOINT = 'http://minio.local:9000';
  process.env.KNOWLEDGE_S3_BUCKET = 'knowledge';
  process.env.KNOWLEDGE_S3_ACCESS_KEY = 'test-access-key';
  process.env.KNOWLEDGE_S3_SECRET_KEY = 'test-secret-key';
});

describe('migrateKnowledgeFilesToObjectStorage', () => {
  it('переносит документ с дисковым storagePath в объектное хранилище и обновляет запись', async () => {
    const sourcePath = path.join(tempDir, 'doc-1.pdf');
    await fs.promises.writeFile(sourcePath, 'содержимое документа');
    const doc = await createDoc({ storagePath: sourcePath });

    const result = await migrateKnowledgeFilesToObjectStorage(knowledgeDocumentModel());

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      migrated: 1,
      alreadyMigrated: 0,
      missing: 0,
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);

    const updated = await knowledgeDocumentModel().findById(doc._id);
    expect(updated?.storagePath).toBe(
      `s3://knowledge/${doc.spaceId.toString()}/${doc.file_id}.pdf`,
    );
  });

  it('пропускает документ, уже перенесённый в объектное хранилище', async () => {
    const doc = await createDoc({ storagePath: 's3://knowledge/space-1/already.pdf' });

    const result = await migrateKnowledgeFilesToObjectStorage(knowledgeDocumentModel());

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 0,
      migrated: 0,
      alreadyMigrated: 1,
      missing: 0,
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);

    const untouched = await knowledgeDocumentModel().findById(doc._id);
    expect(untouched?.storagePath).toBe('s3://knowledge/space-1/already.pdf');
  });

  it('в режиме --dry-run считает документы, но ничего не пишет', async () => {
    const sourcePath = path.join(tempDir, 'doc-2.pdf');
    await fs.promises.writeFile(sourcePath, 'содержимое документа');
    const doc = await createDoc({ storagePath: sourcePath });

    const result = await migrateKnowledgeFilesToObjectStorage(knowledgeDocumentModel(), {
      dryRun: true,
    });

    expect(result).toMatchObject({ scanned: 1, eligible: 1, migrated: 0 });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);

    const untouched = await knowledgeDocumentModel().findById(doc._id);
    expect(untouched?.storagePath).toBe(sourcePath);
  });

  it('пропавший на диске файл не роняет миграцию и учитывается в отчёте', async () => {
    const missingPath = path.join(tempDir, 'does-not-exist.pdf');
    const missingDoc = await createDoc({ storagePath: missingPath });

    const okPath = path.join(tempDir, 'doc-3.pdf');
    await fs.promises.writeFile(okPath, 'содержимое документа');
    const okDoc = await createDoc({ storagePath: okPath });

    const result = await migrateKnowledgeFilesToObjectStorage(knowledgeDocumentModel());

    expect(result.missing).toBe(1);
    expect(result.missingFiles).toEqual([
      expect.objectContaining({ fileId: missingDoc.file_id, storagePath: missingPath }),
    ]);
    expect(result.migrated).toBe(1);

    const untouchedMissing = await knowledgeDocumentModel().findById(missingDoc._id);
    expect(untouchedMissing?.storagePath).toBe(missingPath);

    const migratedOk = await knowledgeDocumentModel().findById(okDoc._id);
    expect(migratedOk?.storagePath).toMatch(/^s3:\/\//);
  });
});
