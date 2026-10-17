import fs from 'fs';
import { logger } from '@librechat/data-schemas';
import { estimatePdfTokens } from 'librechat-data-provider';
import type { DocumentBudget } from '../../files/documents/fit';
import type { DocumentSizeInspection } from './upload';
import { assessDocumentFit } from '../../files/documents/fit';
import { toSizeInspection } from './upload';

const PDF_MIME_TYPE = 'application/pdf';

interface PdfLoadingTask {
  promise: Promise<{ numPages: number }>;
  destroy: () => Promise<void>;
}

export interface InspectPdfSizeInput {
  filePath: string;
  filename: string;
  warnTokens: number;
  budget?: DocumentBudget;
}

export interface InspectPdfUploadInput {
  mimetype: string;
  filePath?: string;
  filename: string;
  warnTokens: number;
  budget?: DocumentBudget;
}

export type CountPdfPages = (filePath: string) => Promise<number>;

/**
 * Ноль означает «посчитать не удалось», а не «страниц нет»: битый или
 * зашифрованный PDF не должен отменять загрузку — он уйдёт провайдеру без
 * проверки объёма, как уходил до этой задачи.
 *
 * Внутреннее состояние pdf.js (шрифты, кэш страниц) держится до `destroy()`,
 * а не до сборки мусора, поэтому задача уничтожается в `finally`; отрисовка
 * страниц здесь не нужна, и всё, что тянет шрифты и `eval`, выключено.
 */
export async function countPdfPages(filePath: string): Promise<number> {
  let loadingTask: PdfLoadingTask | undefined;
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.promises.readFile(filePath));
    loadingTask = getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  } catch (error) {
    logger.warn('[documents] не удалось посчитать страницы PDF:', error);
    return 0;
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

export async function inspectPdfSize(
  input: InspectPdfSizeInput,
  countPages: CountPdfPages = countPdfPages,
): Promise<DocumentSizeInspection> {
  const pageCount = await countPages(input.filePath);
  if (pageCount === 0) {
    return {
      tokenCount: 0,
      pageCount: null,
      verdict: 'ok',
      rejection: null,
      errorCode: null,
      params: null,
    };
  }

  const tokenCount = estimatePdfTokens(pageCount);
  const fit = input.budget
    ? await assessDocumentFit({
        tokenCount,
        pageCount,
        filename: input.filename,
        budget: input.budget,
      })
    : null;

  return toSizeInspection({
    tokenCount,
    pageCount,
    warnTokens: input.warnTokens,
    rejection: fit?.rejection ?? null,
  });
}

/**
 * Гейт для загрузки, которая уходит провайдеру как есть. `null` означает
 * «мерить нечего»: файл не PDF либо не лёг на диск (memory-storage), и второй
 * случай отделён от «не смогли посчитать» отдельной записью в логе — иначе
 * смена стратегии загрузки бесшумно выключила бы проверку.
 */
export async function inspectPdfUpload(
  input: InspectPdfUploadInput,
  countPages: CountPdfPages = countPdfPages,
): Promise<DocumentSizeInspection | null> {
  if (input.mimetype !== PDF_MIME_TYPE) {
    return null;
  }

  const { filePath } = input;
  if (!filePath) {
    logger.warn(`[documents] PDF size check skipped: "${input.filename}" was not written to disk`);
    return null;
  }

  return await inspectPdfSize({ ...input, filePath }, countPages);
}
