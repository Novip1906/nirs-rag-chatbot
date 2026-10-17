import {
  megabyte,
  EToolResources,
  AttachmentErrorCodes,
  createAttachmentErrorBody,
  documentParserMimeTypes,
  documentParserSizeLimit,
} from 'librechat-data-provider';
import type { AttachmentErrorBody } from 'librechat-data-provider';
import type { CustomError } from '~/types';

export interface InspectParserUploadInput {
  toolResource?: string;
  mimetype: string;
  size?: number;
  filename: string;
}

function isParserType(mimetype: string): boolean {
  return documentParserMimeTypes.some((pattern) => pattern.test(mimetype));
}

export function inspectParserUpload(input: InspectParserUploadInput): AttachmentErrorBody | null {
  if (input.toolResource !== EToolResources.context) {
    return null;
  }
  if ((input.size ?? 0) <= documentParserSizeLimit || !isParserType(input.mimetype)) {
    return null;
  }
  return createAttachmentErrorBody(AttachmentErrorCodes.too_large, {
    filename: input.filename,
    limitMb: documentParserSizeLimit / megabyte,
  });
}

export function createUnsupportedFormatError(filename?: string): CustomError {
  const body = createAttachmentErrorBody(AttachmentErrorCodes.unsupported_format, { filename });
  const error = new Error(body.message) as CustomError;
  error.statusCode = 415;
  error.body = body;
  return error;
}
