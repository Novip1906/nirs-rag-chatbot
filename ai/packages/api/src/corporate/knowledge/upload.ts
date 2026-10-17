import { logger } from '@librechat/data-schemas';

/**
 * `multer({ dest })` пишет файл на диск ещё до входа в обработчик и сам чистит его
 * только при ошибке разбора запроса. Ранний отказ обработчика (пустое название,
 * слишком длинное описание, недоступное пространство, неподдерживаемый тип) иначе
 * оставлял бы файл до 25 МБ на PVC навсегда — том переполняется молча. Общий
 * помощник для обоих обработчиков загрузки (админского и сотрудника): вызывается
 * на каждом раннем возврате и в `finally` на успешном пути тоже — `saveOriginal`
 * копирует файл в постоянное хранилище, а не переносит, поэтому временный файл
 * остаётся и после удачной загрузки.
 */
export async function removeUploadTemp(
  removeOriginal: (storagePath: string) => Promise<void>,
  uploadPath: string | undefined,
): Promise<void> {
  if (!uploadPath) {
    return;
  }
  try {
    await removeOriginal(uploadPath);
  } catch (error) {
    logger.warn('[knowledgeUpload] временный файл загрузки не удалён:', error);
  }
}
