import fs from 'fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';

export interface SaveOriginalToObjectStorageInput {
  spaceId: string;
  fileId: string;
  sourcePath: string;
  extension: string;
}

interface ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const S3_PATH_PREFIX = 's3://';

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const endpoint = process.env.KNOWLEDGE_S3_ENDPOINT;
  const bucket = process.env.KNOWLEDGE_S3_BUCKET;
  const accessKeyId = process.env.KNOWLEDGE_S3_ACCESS_KEY;
  const secretAccessKey = process.env.KNOWLEDGE_S3_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.KNOWLEDGE_S3_REGION || 'us-east-1',
  };
}

export function isObjectStorageConfigured(): boolean {
  return getObjectStorageConfig() != null;
}

function requireObjectStorageConfig(): ObjectStorageConfig {
  const config = getObjectStorageConfig();
  if (!config) {
    throw new Error(
      'Knowledge object storage is not configured: set KNOWLEDGE_S3_ENDPOINT, ' +
        'KNOWLEDGE_S3_BUCKET, KNOWLEDGE_S3_ACCESS_KEY and KNOWLEDGE_S3_SECRET_KEY',
    );
  }
  return config;
}

function getS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function toStoragePath(bucket: string, key: string): string {
  return `${S3_PATH_PREFIX}${bucket}/${key}`;
}

function parseStoragePath(storagePath: string): { bucket: string; key: string } {
  if (!storagePath.startsWith(S3_PATH_PREFIX)) {
    throw new Error(`Expected an "s3://" storage path, got: ${storagePath}`);
  }
  const [bucket, ...keyParts] = storagePath.slice(S3_PATH_PREFIX.length).split('/');
  return { bucket, key: keyParts.join('/') };
}

async function streamToBuffer(body: GetObjectCommandOutput['Body']): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function saveOriginalToObjectStorage(
  input: SaveOriginalToObjectStorageInput,
): Promise<string> {
  const config = requireObjectStorageConfig();
  const extension = input.extension.replace(/^\./, '');
  const key = `${input.spaceId}/${extension ? `${input.fileId}.${extension}` : input.fileId}`;
  const body = await fs.promises.readFile(input.sourcePath);
  const s3 = getS3Client(config);
  await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }));
  return toStoragePath(config.bucket, key);
}

export async function readOriginalFromObjectStorage(storagePath: string): Promise<Buffer> {
  const { bucket, key } = parseStoragePath(storagePath);
  const config = requireObjectStorageConfig();
  const s3 = getS3Client(config);
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`Object storage returned an empty body for: ${storagePath}`);
  }
  return streamToBuffer(response.Body);
}

export async function removeOriginalFromObjectStorage(storagePath: string): Promise<void> {
  if (!storagePath) {
    return;
  }
  const { bucket, key } = parseStoragePath(storagePath);
  const config = requireObjectStorageConfig();
  const s3 = getS3Client(config);
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') {
      return;
    }
    throw error;
  }
}
