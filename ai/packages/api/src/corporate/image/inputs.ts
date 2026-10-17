import { logger } from '@librechat/data-schemas';
import { Tools } from 'librechat-data-provider';
import { ImageToolError } from './validate';

export const MAX_INPUT_IMAGE_BYTES: number = 20 * 1024 * 1024;

export interface InputImageFile {
  file_id: string;
  type: string;
  filepath: string;
  source?: string;
  filename?: string;
  bytes?: number;
}

export interface InputImageDeps {
  requestFiles: InputImageFile[];
  findUserImages: (fileIds: string[]) => Promise<InputImageFile[]>;
  readFile: (file: InputImageFile) => Promise<Buffer>;
}

function missingImageMessage(fileId: string): string {
  return (
    `Картинка ${fileId} не найдена среди картинок сотрудника. Попроси его прикрепить исходную ` +
    'картинку к сообщению заново.'
  );
}

const INPUT_UNAVAILABLE_MESSAGE =
  'Не удалось прочитать исходную картинку. Попроси сотрудника прикрепить её к сообщению заново.';

function tooLargeMessage(file: InputImageFile): string {
  return `Картинка «${file.filename ?? file.file_id}» слишком большая для правки — нужна до 20 МБ.`;
}

async function guarded<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ImageToolError) {
      throw error;
    }
    logger.error('[image] Не удалось подготовить исходную картинку', error);
    throw new ImageToolError(INPUT_UNAVAILABLE_MESSAGE);
  }
}

function toDataUrl(file: InputImageFile, buffer: Buffer): string {
  return `data:${file.type};base64,${buffer.toString('base64')}`;
}

async function resolveFiles(deps: InputImageDeps, ids: string[]): Promise<InputImageFile[]> {
  const known = new Map(deps.requestFiles.map((file) => [file.file_id, file]));
  const unknownIds = ids.filter((id) => !known.has(id));
  if (unknownIds.length > 0) {
    const found = await guarded(() => deps.findUserImages(unknownIds));
    for (const file of found) {
      known.set(file.file_id, file);
    }
  }
  return ids.map((id) => {
    const file = known.get(id);
    if (!file || !file.type.startsWith('image/')) {
      throw new ImageToolError(missingImageMessage(id));
    }
    return file;
  });
}

export async function loadInputImages(deps: InputImageDeps, ids: string[]): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const files = await resolveFiles(deps, ids);
  const oversized = files.find((file) => (file.bytes ?? 0) > MAX_INPUT_IMAGE_BYTES);
  if (oversized) {
    throw new ImageToolError(tooLargeMessage(oversized));
  }
  return Promise.all(
    files.map(async (file) => {
      const buffer = await guarded(() => deps.readFile(file));
      if (buffer.byteLength > MAX_INPUT_IMAGE_BYTES) {
        throw new ImageToolError(tooLargeMessage(file));
      }
      return toDataUrl(file, buffer);
    }),
  );
}

export function buildImageInputContext(files: Array<{ file_id: string }>): string {
  if (files.length === 0) {
    return '';
  }
  const ids = files.map((file) => `- ${file.file_id}`).join('\n');
  return (
    `Картинки, прикреплённые сотрудником к этому сообщению (идентификаторы по порядку):\n${ids}\n\n` +
    `Если сотрудник просит изменить их или нарисовать что-то на их основе, передай нужные ` +
    `идентификаторы в image_ids инструмента ${Tools.generate_image}.`
  );
}
