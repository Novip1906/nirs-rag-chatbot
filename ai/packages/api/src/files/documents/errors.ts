import {
  AttachmentErrorCodes,
  createAttachmentErrorBody,
  isAttachmentErrorCode,
} from 'librechat-data-provider';
import type {
  AttachmentErrorBody,
  AttachmentErrorCode,
  AttachmentErrorParams,
} from 'librechat-data-provider';
import { ZipBombError } from './zipSafety';

export const PARSE_TIMEOUT_MESSAGE = 'Document parsing timed out';

export class DocumentParseError extends Error {
  readonly errorCode: AttachmentErrorCode;
  readonly params: AttachmentErrorParams;
  readonly userErrorStatusCode = 422;

  constructor(
    errorCode: AttachmentErrorCode,
    params: AttachmentErrorParams = {},
    message?: string,
  ) {
    super(message ?? createAttachmentErrorBody(errorCode, params).message);
    this.name = 'DocumentParseError';
    this.errorCode = errorCode;
    this.params = params;
    Object.setPrototypeOf(this, DocumentParseError.prototype);
  }
}

interface DocumentParseErrorLike {
  name?: string;
  errorCode?: string;
  userErrorStatusCode?: number;
}

export function isDocumentParseError(value: unknown): value is DocumentParseError {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as DocumentParseErrorLike;
  return (
    candidate.name === 'DocumentParseError' &&
    typeof candidate.errorCode === 'string' &&
    isAttachmentErrorCode(candidate.errorCode) &&
    candidate.userErrorStatusCode === 422
  );
}

export interface ParseFailureContext {
  filename?: string;
  timeoutMs?: number;
}

interface PasswordFailureLike {
  name?: string;
  message?: string;
}

function isPasswordFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as PasswordFailureLike;
  if (candidate.name === 'PasswordException') {
    return true;
  }
  return (
    typeof candidate.message === 'string' && candidate.message.toLowerCase().includes('password')
  );
}

function isTimeoutFailure(error: unknown): error is Error {
  return error instanceof Error && error.message === PARSE_TIMEOUT_MESSAGE;
}

export function classifyParseFailure(
  error: unknown,
  context: ParseFailureContext = {},
): DocumentParseError {
  if (isDocumentParseError(error)) {
    return error;
  }
  if (error instanceof ZipBombError) {
    return new DocumentParseError(
      AttachmentErrorCodes.unpacked_too_large,
      { filename: context.filename },
      error.message,
    );
  }
  if (isPasswordFailure(error)) {
    return new DocumentParseError(
      AttachmentErrorCodes.encrypted,
      { filename: context.filename },
      error instanceof Error ? error.message : undefined,
    );
  }
  if (isTimeoutFailure(error)) {
    return new DocumentParseError(AttachmentErrorCodes.parse_timeout, {
      filename: context.filename,
      seconds: Math.ceil((context.timeoutMs ?? 0) / 1000),
    });
  }
  return new DocumentParseError(
    AttachmentErrorCodes.corrupted,
    { filename: context.filename },
    error instanceof Error ? error.message : undefined,
  );
}

export function toAttachmentErrorBody(error: DocumentParseError): AttachmentErrorBody {
  return createAttachmentErrorBody(error.errorCode, error.params);
}
