import fs from 'fs';
import path from 'path';

export interface SaveOriginalToDiskInput {
  uploadsRoot: string;
  spaceId: string;
  fileId: string;
  sourcePath: string;
  extension: string;
}

/**
 * Оригинал документа сохраняется на диск отдельно от векторов в pgvector: он нужен для
 * переиндексации при смене модели эмбеддингов и для сверки админом. Путь —
 * `<uploadsRoot>/<spaceId>/<fileId>.<extension>`, как описано в дизайне базы знаний.
 */
export async function saveOriginalToDisk(input: SaveOriginalToDiskInput): Promise<string> {
  const dir = path.join(input.uploadsRoot, input.spaceId);
  await fs.promises.mkdir(dir, { recursive: true });
  const extension = input.extension.replace(/^\./, '');
  const destination = path.join(dir, extension ? `${input.fileId}.${extension}` : input.fileId);
  await fs.promises.copyFile(input.sourcePath, destination);
  return destination;
}

/**
 * Файл, уже отсутствующий на диске, не считается ошибкой: удаление могло повториться
 * (например, после неудачной переиндексации) или PVC мог быть пересоздан.
 */
export async function removeOriginalFromDisk(storagePath: string): Promise<void> {
  if (!storagePath) {
    return;
  }
  try {
    await fs.promises.unlink(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
