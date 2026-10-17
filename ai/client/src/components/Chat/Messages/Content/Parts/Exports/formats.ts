import {
  FileText,
  FilePenLine,
  Presentation,
  FileSpreadsheet,
  Table,
  FileCode2,
} from 'lucide-react';
import type { TFile } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';

export type ExportFormatKey = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv' | 'md';

export interface ExportFormatDescriptor {
  key: ExportFormatKey;
  Icon: LucideIcon;
  toneClassName: string;
  labelKey: TranslationKeys;
}

export const EXPORT_FORMAT_DESCRIPTORS: Readonly<Record<ExportFormatKey, ExportFormatDescriptor>> =
  {
    pdf: {
      key: 'pdf',
      Icon: FileText,
      toneClassName: 'bg-series-5',
      labelKey: 'com_ui_export_format_pdf',
    },
    docx: {
      key: 'docx',
      Icon: FilePenLine,
      toneClassName: 'bg-series-1',
      labelKey: 'com_ui_export_format_docx',
    },
    pptx: {
      key: 'pptx',
      Icon: Presentation,
      toneClassName: 'bg-series-2',
      labelKey: 'com_ui_export_format_pptx',
    },
    xlsx: {
      key: 'xlsx',
      Icon: FileSpreadsheet,
      toneClassName: 'bg-series-7',
      labelKey: 'com_ui_export_format_xlsx',
    },
    csv: {
      key: 'csv',
      Icon: Table,
      toneClassName: 'bg-series-3',
      labelKey: 'com_ui_export_format_csv',
    },
    md: {
      key: 'md',
      Icon: FileCode2,
      toneClassName: 'bg-series-6',
      labelKey: 'com_ui_export_format_md',
    },
  };

const EXPORT_FORMAT_EXTENSIONS = new Set<string>(Object.keys(EXPORT_FORMAT_DESCRIPTORS));

const MIME_TO_EXPORT_FORMAT_KEY = new Map<string, ExportFormatKey>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['text/csv', 'csv'],
  ['text/markdown', 'md'],
]);

export function resolveExportFormat(
  file: Pick<TFile, 'filename' | 'type'>,
): ExportFormatDescriptor | null {
  const lastDotIndex = file.filename.lastIndexOf('.');

  if (lastDotIndex > -1) {
    const extension = file.filename.slice(lastDotIndex + 1).toLowerCase();
    if (EXPORT_FORMAT_EXTENSIONS.has(extension)) {
      return EXPORT_FORMAT_DESCRIPTORS[extension as ExportFormatKey];
    }
  }

  const mimeType = file.type.split(';')[0].trim().toLowerCase();
  const key = MIME_TO_EXPORT_FORMAT_KEY.get(mimeType);

  return key != null ? EXPORT_FORMAT_DESCRIPTORS[key] : null;
}
