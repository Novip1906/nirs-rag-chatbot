import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { mockClient } from 'aws-sdk-client-mock';
import { sdkStreamMixin } from '@smithy/util-stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  isObjectStorageConfigured,
  saveOriginalToObjectStorage,
  readOriginalFromObjectStorage,
  removeOriginalFromObjectStorage,
} from './objectStorage';

const s3Mock = mockClient(S3Client);

describe('objectStorage', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'knowledge-object-storage-'));
  });

  afterAll(async () => {
    process.env = originalEnv;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    s3Mock.reset();
    process.env.KNOWLEDGE_S3_ENDPOINT = 'http://minio.local:9000';
    process.env.KNOWLEDGE_S3_BUCKET = 'knowledge';
    process.env.KNOWLEDGE_S3_ACCESS_KEY = 'test-access-key';
    process.env.KNOWLEDGE_S3_SECRET_KEY = 'test-secret-key';
    delete process.env.KNOWLEDGE_S3_REGION;
  });

  it('reports configured when all required env vars are set', () => {
    expect(isObjectStorageConfigured()).toBe(true);
  });

  it('reports not configured when env vars are missing', () => {
    delete process.env.KNOWLEDGE_S3_ACCESS_KEY;
    expect(isObjectStorageConfigured()).toBe(false);
  });

  it('saves the source file under <spaceId>/<fileId>.<ext> and returns an s3:// path', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const sourcePath = path.join(tempDir, 'source.pdf');
    await fs.promises.writeFile(sourcePath, 'file contents');

    const storagePath = await saveOriginalToObjectStorage({
      spaceId: 'space-1',
      fileId: 'file-1',
      sourcePath,
      extension: '.pdf',
    });

    expect(storagePath).toBe('s3://knowledge/space-1/file-1.pdf');
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: 'knowledge',
      Key: 'space-1/file-1.pdf',
      Body: Buffer.from('file contents'),
    });
  });

  it('reads content back from an s3:// storage path', async () => {
    const stream = new Readable();
    stream.push('stored content');
    stream.push(null);
    s3Mock.on(GetObjectCommand).resolves({ Body: sdkStreamMixin(stream) });

    const buffer = await readOriginalFromObjectStorage('s3://knowledge/space-1/file-1.pdf');

    expect(buffer.toString()).toBe('stored content');
    expect(s3Mock.commandCalls(GetObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: 'knowledge',
      Key: 'space-1/file-1.pdf',
    });
  });

  it('rejects a storage path outside the s3:// scheme', async () => {
    await expect(
      readOriginalFromObjectStorage('/uploads/space-1/file-1.pdf'),
    ).rejects.toThrow('s3://');
  });

  it('does not throw when removing an object that is already gone', async () => {
    s3Mock
      .on(DeleteObjectCommand)
      .rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

    await expect(
      removeOriginalFromObjectStorage('s3://knowledge/space-1/file-1.pdf'),
    ).resolves.toBeUndefined();
  });
});
