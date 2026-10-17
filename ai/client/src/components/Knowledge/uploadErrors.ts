import {
  KNOWLEDGE_DOCUMENT_EXTENSIONS,
  KNOWLEDGE_DOCUMENT_MAX_BYTES,
} from 'librechat-data-provider';
import type { TranslationKeys, useLocalize } from '~/hooks';

type Localize = ReturnType<typeof useLocalize>;

/**
 * Сервер отвечает этими двумя строками по-английски (см. `packages/api/src/corporate/knowledge/employee.ts`);
 * сотруднику они переводятся по точному тексту, а не выводятся как есть.
 */
const KNOWN_ENGLISH_SERVER_ERRORS: Record<string, TranslationKeys> = {
  'File exceeds the 25 MB limit': 'com_knowledge_upload_error_file_too_large',
  'Unsupported file type': 'com_knowledge_upload_error_unsupported_type',
};

const CYRILLIC_PATTERN = /[а-яё]/i;

/**
 * Значение `accept` для `<input type="file">` — тот же список расширений, что и
 * серверная проверка, чтобы диалог выбора файла в системе сразу отсекал заведомо
 * непроходные форматы, а не только показывал ошибку после выбора.
 */
export const KNOWLEDGE_DOCUMENT_ACCEPT = KNOWLEDGE_DOCUMENT_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(',');

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Отсекает то, что заведомо не пройдёт на сервере, — до отправки файла целиком, а не
 * после. Расширения и лимит размера берутся из общего с сервером источника
 * (`librechat-data-provider`), а не из отдельно придуманного на клиенте списка.
 */
export function validateSelectedFile(file: File, localize: Localize): string | null {
  if (file.size > KNOWLEDGE_DOCUMENT_MAX_BYTES) {
    return localize('com_knowledge_upload_error_file_too_large');
  }
  if (!KNOWLEDGE_DOCUMENT_EXTENSIONS.includes(fileExtension(file.name))) {
    return localize('com_knowledge_upload_error_unsupported_type');
  }
  return null;
}

/**
 * Сервер отвечает содержательным текстом отказа (сканы, повреждённые файлы и т.п.) —
 * его и нужно показать сотруднику вместо одной общей строки. Русский текст сервера
 * показывается как есть (определяется по содержимому, а не по перечислению всех
 * возможных сообщений); известные англоязычные ответы переводятся отдельно; всё
 * остальное — общая формулировка, чтобы сотрудник не увидел необработанную
 * английскую строку.
 */
export function resolveUploadErrorMessage(error: unknown, localize: Localize): string {
  const serverError = (error as { response?: { data?: { error?: string } } })?.response?.data
    ?.error;
  if (serverError == null) {
    return localize('com_knowledge_document_upload_error');
  }

  const knownKey = KNOWN_ENGLISH_SERVER_ERRORS[serverError];
  if (knownKey != null) {
    return localize(knownKey);
  }

  if (CYRILLIC_PATTERN.test(serverError)) {
    return serverError;
  }

  return localize('com_knowledge_document_upload_error');
}
