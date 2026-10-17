import type { RegexLike } from './types/files';

export const AttachmentErrorCodes = {
  unsupported_format: 'unsupported_format',
  too_large: 'too_large',
  unpacked_too_large: 'unpacked_too_large',
  context_overflow: 'context_overflow',
  no_text: 'no_text',
  encrypted: 'encrypted',
  corrupted: 'corrupted',
  parse_timeout: 'parse_timeout',
} as const;

export type AttachmentErrorCode = (typeof AttachmentErrorCodes)[keyof typeof AttachmentErrorCodes];

const ATTACHMENT_ERROR_CODE_VALUES: readonly string[] = Object.values(AttachmentErrorCodes);

export function isAttachmentErrorCode(value: string): value is AttachmentErrorCode {
  return ATTACHMENT_ERROR_CODE_VALUES.includes(value);
}

export interface AttachmentErrorParams {
  filename?: string;
  limitMb?: number;
  seconds?: number;
  pageCount?: number;
  tokens?: number;
  contextTokens?: number;
  requiredContextTokens?: number;
  modelLabel?: string;
}

export interface AttachmentErrorBody {
  message: string;
  errorCode: AttachmentErrorCode;
  params: AttachmentErrorParams;
}

function describeFile(params: AttachmentErrorParams): string {
  return params.filename ? `"${params.filename}"` : 'The file';
}

const ATTACHMENT_ERROR_FALLBACKS: Record<
  AttachmentErrorCode,
  (params: AttachmentErrorParams) => string
> = {
  unsupported_format: (params) => `${describeFile(params)} is not a supported file format.`,
  too_large: (params) =>
    params.limitMb != null
      ? `${describeFile(params)} exceeds the ${params.limitMb} MB size limit.`
      : `${describeFile(params)} exceeds the size limit.`,
  unpacked_too_large: (params) =>
    params.limitMb != null
      ? `${describeFile(params)} is too large once unpacked (limit ${params.limitMb} MB).`
      : `${describeFile(params)} is too large once unpacked.`,
  context_overflow: (params) => {
    const model = params.modelLabel ? ` for ${params.modelLabel}` : '';
    const need =
      params.requiredContextTokens != null
        ? ` It needs a model with at least ${params.requiredContextTokens} tokens of context.`
        : '';
    return `${describeFile(params)} is too large to fit the current context window${model}.${need}`;
  },
  no_text: (params) => `${describeFile(params)} has no extractable text.`,
  encrypted: (params) => `${describeFile(params)} is password protected.`,
  corrupted: (params) =>
    `${describeFile(params)} could not be read — the file appears to be corrupted.`,
  parse_timeout: (params) =>
    params.seconds != null
      ? `${describeFile(params)} took too long to parse (over ${params.seconds}s).`
      : `${describeFile(params)} took too long to parse.`,
};

export function createAttachmentErrorBody(
  errorCode: AttachmentErrorCode,
  params: AttachmentErrorParams = {},
): AttachmentErrorBody {
  return {
    message: ATTACHMENT_ERROR_FALLBACKS[errorCode](params),
    errorCode,
    params,
  };
}

export type AttachmentFormatGroup =
  | 'documents'
  | 'spreadsheets'
  | 'presentations'
  | 'images'
  | 'textAndCode';

export interface AttachmentFormat {
  id: string;
  extension: string;
  group: AttachmentFormatGroup;
  mimeTypes: readonly string[];
}

export const ATTACHMENT_FORMATS: Readonly<
  Record<AttachmentFormatGroup, readonly AttachmentFormat[]>
> = {
  documents: [
    { id: 'pdf', extension: 'pdf', group: 'documents', mimeTypes: ['application/pdf'] },
    {
      id: 'docx',
      extension: 'docx',
      group: 'documents',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    },
    { id: 'doc', extension: 'doc', group: 'documents', mimeTypes: ['application/msword'] },
    { id: 'rtf', extension: 'rtf', group: 'documents', mimeTypes: ['application/rtf', 'text/rtf'] },
    {
      id: 'odt',
      extension: 'odt',
      group: 'documents',
      mimeTypes: ['application/vnd.oasis.opendocument.text'],
    },
  ],
  spreadsheets: [
    {
      id: 'xlsx',
      extension: 'xlsx',
      group: 'spreadsheets',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    },
    { id: 'xls', extension: 'xls', group: 'spreadsheets', mimeTypes: ['application/vnd.ms-excel'] },
    {
      id: 'ods',
      extension: 'ods',
      group: 'spreadsheets',
      mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'],
    },
  ],
  presentations: [
    {
      id: 'pptx',
      extension: 'pptx',
      group: 'presentations',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    },
  ],
  images: [
    { id: 'jpg', extension: 'jpg', group: 'images', mimeTypes: ['image/jpeg'] },
    { id: 'png', extension: 'png', group: 'images', mimeTypes: ['image/png'] },
    { id: 'webp', extension: 'webp', group: 'images', mimeTypes: ['image/webp'] },
    { id: 'gif', extension: 'gif', group: 'images', mimeTypes: ['image/gif'] },
    { id: 'heic', extension: 'heic', group: 'images', mimeTypes: ['image/heic'] },
    { id: 'heif', extension: 'heif', group: 'images', mimeTypes: ['image/heif'] },
  ],
  textAndCode: [
    { id: 'txt', extension: 'txt', group: 'textAndCode', mimeTypes: ['text/plain'] },
    { id: 'md', extension: 'md', group: 'textAndCode', mimeTypes: ['text/markdown'] },
    {
      id: 'csv',
      extension: 'csv',
      group: 'textAndCode',
      mimeTypes: ['text/csv', 'application/csv'],
    },
    { id: 'json', extension: 'json', group: 'textAndCode', mimeTypes: ['application/json'] },
    {
      id: 'xml',
      extension: 'xml',
      group: 'textAndCode',
      mimeTypes: ['application/xml', 'text/xml'],
    },
    {
      id: 'yaml',
      extension: 'yaml',
      group: 'textAndCode',
      mimeTypes: ['application/yaml', 'application/x-yaml'],
    },
    { id: 'sql', extension: 'sql', group: 'textAndCode', mimeTypes: ['application/sql'] },
    { id: 'ts', extension: 'ts', group: 'textAndCode', mimeTypes: ['application/typescript'] },
    { id: 'sh', extension: 'sh', group: 'textAndCode', mimeTypes: ['application/x-sh'] },
    { id: 'html', extension: 'html', group: 'textAndCode', mimeTypes: ['text/html'] },
    { id: 'css', extension: 'css', group: 'textAndCode', mimeTypes: ['text/css'] },
    {
      id: 'py',
      extension: 'py',
      group: 'textAndCode',
      mimeTypes: ['text/x-python', 'text/x-script.python'],
    },
    { id: 'js', extension: 'js', group: 'textAndCode', mimeTypes: ['text/javascript'] },
    {
      id: 'coffee',
      extension: 'coffee',
      group: 'textAndCode',
      mimeTypes: ['application/vnd.coffeescript'],
    },
  ],
};

export function listAcceptedFormats(supportedMimeTypes: readonly RegexLike[]): AttachmentFormat[] {
  return Object.values(ATTACHMENT_FORMATS)
    .flat()
    .filter((format) =>
      format.mimeTypes.some((mimeType) => supportedMimeTypes.some((regex) => regex.test(mimeType))),
    );
}

export function findAttachmentFormat(mimeType: string): AttachmentFormat | null {
  for (const formats of Object.values(ATTACHMENT_FORMATS)) {
    const match = formats.find((format) => format.mimeTypes.includes(mimeType));
    if (match) {
      return match;
    }
  }
  return null;
}
