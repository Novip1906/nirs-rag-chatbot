import type { ExportFileInput, RenderedFile } from './types';
import { ExportFileError, EXPORT_MIME_TYPES } from './types';
import { parseMarkdownBlocks } from './markdown';
import { renderCsv, renderXlsx } from './sheet';
import { renderMarkdownFile } from './md';
import { renderPptx } from './slides';
import { renderDocx } from './docx';
import { renderPdf } from './pdf';

export interface ExportLimits {
  timeoutMs: number;
  maxBytes: number;
}

export const DEFAULT_EXPORT_LIMITS: ExportLimits = {
  timeoutMs: 20_000,
  maxBytes: 20 * 1024 * 1024,
};

const BYTES_IN_MEGABYTE = 1024 * 1024;

function megabytes(bytes: number): string {
  return (bytes / BYTES_IN_MEGABYTE).toFixed(1).replace('.', ',');
}

export function withExportTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ExportFileError(
          `Сборка файла не уложилась в ${Math.round(timeoutMs / 1000)} с — сократи содержимое или раздели его на несколько файлов.`,
        ),
      );
    }, timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function renderBuffer(input: ExportFileInput): Promise<Buffer> {
  switch (input.format) {
    case 'docx':
      return renderDocx(await parseMarkdownBlocks(input.markdown), input.title);
    case 'pdf':
      return renderPdf(await parseMarkdownBlocks(input.markdown), input.title);
    case 'md':
      return renderMarkdownFile(input.markdown, input.title);
    case 'xlsx':
      return renderXlsx(input.sheets);
    case 'csv':
      return renderCsv(input.sheets[0]);
    case 'pptx':
      return renderPptx(input.slides, input.title);
  }
}

export async function renderExportFile(
  input: ExportFileInput,
  limits: ExportLimits = DEFAULT_EXPORT_LIMITS,
): Promise<RenderedFile> {
  let buffer: Buffer;
  try {
    buffer = await withExportTimeout(renderBuffer(input), limits.timeoutMs);
  } catch (error) {
    if (error instanceof ExportFileError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new ExportFileError(`Не удалось собрать файл ${input.format.toUpperCase()}: ${reason}`);
  }
  if (buffer.length > limits.maxBytes) {
    throw new ExportFileError(
      `Файл получился слишком большим: ${megabytes(buffer.length)} МБ при пределе ${megabytes(limits.maxBytes)} МБ — сократи содержимое или раздели его на несколько файлов.`,
    );
  }
  return { buffer, filename: input.filename, mimeType: EXPORT_MIME_TYPES[input.format] };
}
