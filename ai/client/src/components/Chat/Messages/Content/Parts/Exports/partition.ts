import { FileContext } from 'librechat-data-provider';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';

export interface ExportedFilesPartition {
  attachments: TAttachment[];
  exportedFiles: TAttachment[];
}

export function partitionExportedFiles(attachments?: TAttachment[]): ExportedFilesPartition {
  const rest: TAttachment[] = [];
  const exportedByKey = new Map<string, TAttachment>();
  const order: string[] = [];

  for (const attachment of attachments ?? []) {
    const file = attachment as TFile & TAttachmentMetadata;
    if (file.context !== FileContext.export_file) {
      rest.push(attachment);
      continue;
    }
    if (!attachment.filepath) {
      continue;
    }
    const key = file.file_id ?? attachment.filepath;
    if (!exportedByKey.has(key)) {
      order.push(key);
    }
    exportedByKey.set(key, attachment);
  }

  return {
    attachments: rest,
    exportedFiles: order.map((key) => exportedByKey.get(key) as TAttachment),
  };
}
