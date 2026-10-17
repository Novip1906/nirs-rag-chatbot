import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { FileContext } from 'librechat-data-provider';
import type { TFile, FileSources } from 'librechat-data-provider';
import type { SaveBufferFn } from '~/storage/types';
import { getStorageMetadata } from '~/storage/metadata';
import { takeRenderedExport } from './store';

export type ExportFileRecord = Pick<
  TFile,
  | 'user'
  | 'tenantId'
  | 'file_id'
  | 'filename'
  | 'filepath'
  | 'storageKey'
  | 'storageRegion'
  | 'object'
  | 'type'
  | 'bytes'
  | 'usage'
  | 'conversationId'
> & {
  source: FileSources;
  context: FileContext;
  messageId?: string;
  expiredAt?: Date;
};

export type ExportAttachment = ExportFileRecord & { toolCallId: string };

export interface PersistExportDeps {
  saveBuffer: SaveBufferFn | undefined;
  createFile: (data: ExportFileRecord, disableTTL: boolean) => Promise<Pick<TFile, 'file_id'> | null>;
}

export interface PersistExportParams {
  exportId: string;
  userId: string;
  tenantId?: string;
  source: FileSources;
  conversationId?: string;
  messageId?: string;
  toolCallId: string;
  retention: { expiredAt?: Date };
}

export async function persistExportFile(
  params: PersistExportParams,
  deps: PersistExportDeps,
): Promise<ExportAttachment | null> {
  const rendered = takeRenderedExport(params.exportId);
  if (!rendered) {
    logger.warn(
      `[export_file] Готовый файл ${params.exportId} не найден: срок хранения истёк или вызов пришёл в другой процесс`,
    );
    return null;
  }
  if (!deps.saveBuffer) {
    throw new Error(`Хранилище ${params.source} не умеет сохранять файлы выгрузки`);
  }
  const file_id = randomUUID();
  const filepath = await deps.saveBuffer({
    userId: params.userId,
    buffer: rendered.buffer,
    fileName: `${file_id}${path.extname(rendered.filename)}`,
    basePath: 'uploads',
    tenantId: params.tenantId,
  });
  const record: ExportFileRecord = {
    user: params.userId,
    ...(params.tenantId ? { tenantId: params.tenantId } : {}),
    file_id,
    filename: rendered.filename,
    filepath,
    ...getStorageMetadata({ filepath, source: params.source }),
    object: 'file',
    type: rendered.mimeType,
    bytes: rendered.buffer.length,
    usage: 0,
    source: params.source,
    context: FileContext.export_file,
    conversationId: params.conversationId,
    messageId: params.messageId,
    ...params.retention,
  };
  const created = await deps.createFile(record, true);
  if (!created) {
    throw new Error(`Не удалось записать файл выгрузки ${file_id} в базу`);
  }
  return { ...record, toolCallId: params.toolCallId };
}
