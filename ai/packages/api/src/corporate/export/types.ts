export const EXPORT_FORMATS = ['docx', 'pdf', 'xlsx', 'csv', 'pptx', 'md'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
};

export type SheetCell = string | number | boolean | null;

export type SlideCell = string | number | null;

export interface ExportSheet {
  name: string;
  columns?: string[];
  rows: SheetCell[][];
}

export interface ExportSlideTable {
  columns: string[];
  rows: SlideCell[][];
}

export interface ExportSlide {
  title: string;
  bullets?: string[];
  table?: ExportSlideTable;
  notes?: string;
}

export interface ExportFileBase {
  filename: string;
  title?: string;
}

export interface ExportDocumentInput extends ExportFileBase {
  format: 'docx' | 'pdf' | 'md';
  markdown: string;
}

export interface ExportSheetInput extends ExportFileBase {
  format: 'xlsx' | 'csv';
  sheets: ExportSheet[];
}

export interface ExportSlidesInput extends ExportFileBase {
  format: 'pptx';
  slides: ExportSlide[];
}

export type ExportFileInput = ExportDocumentInput | ExportSheetInput | ExportSlidesInput;

export interface RenderedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type DocumentBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'list'; ordered: boolean; items: InlineRun[][] }
  | { kind: 'table'; header: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: 'code'; text: string };

export class ExportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportFileError';
  }
}
