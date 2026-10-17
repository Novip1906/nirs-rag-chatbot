import fs from 'fs';
import { logger } from '@librechat/data-schemas';
import type { Model } from 'mongoose';
import type { IKnowledgeDocument } from '@librechat/data-schemas';
import { fileExtension } from './mime';
import { saveOriginalToObjectStorage } from './objectStorage';

export interface MigrateKnowledgeFilesOptions {
  dryRun?: boolean;
}

export interface MigrateKnowledgeFilesResult {
  scanned: number;
  eligible: number;
  migrated: number;
  alreadyMigrated: number;
  missing: number;
  missingFiles: Array<{ fileId: string; storagePath: string }>;
}

const OBJECT_STORAGE_PREFIX = 's3://';

async function existsOnDisk(storagePath: string): Promise<boolean> {
  try {
    await fs.promises.access(storagePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function migrateKnowledgeFilesToObjectStorage(
  knowledgeDocumentModel: Model<IKnowledgeDocument>,
  options: MigrateKnowledgeFilesOptions = {},
): Promise<MigrateKnowledgeFilesResult> {
  const dryRun = options.dryRun ?? false;
  const result: MigrateKnowledgeFilesResult = {
    scanned: 0,
    eligible: 0,
    migrated: 0,
    alreadyMigrated: 0,
    missing: 0,
    missingFiles: [],
  };

  const cursor = knowledgeDocumentModel
    .find({}, { spaceId: 1, file_id: 1, filename: 1, storagePath: 1 })
    .cursor();

  for await (const doc of cursor) {
    result.scanned += 1;
    const storagePath = doc.storagePath;

    if (!storagePath || storagePath.startsWith(OBJECT_STORAGE_PREFIX)) {
      result.alreadyMigrated += 1;
      continue;
    }

    if (!(await existsOnDisk(storagePath))) {
      result.missing += 1;
      result.missingFiles.push({ fileId: doc.file_id, storagePath });
      logger.warn(
        `[migrateKnowledgeFilesToObjectStorage] файл не найден на диске: ${storagePath} (file_id: ${doc.file_id})`,
      );
      continue;
    }

    result.eligible += 1;
    if (dryRun) {
      continue;
    }

    const newStoragePath = await saveOriginalToObjectStorage({
      spaceId: doc.spaceId.toString(),
      fileId: doc.file_id,
      sourcePath: storagePath,
      extension: fileExtension(doc.filename),
    });

    await knowledgeDocumentModel.updateOne(
      { _id: doc._id },
      { $set: { storagePath: newStoragePath } },
    );
    result.migrated += 1;
  }

  return result;
}
