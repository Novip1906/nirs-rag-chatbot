import { AttachmentErrorCodes } from 'librechat-data-provider';
import {
  DocumentParseError,
  PARSE_TIMEOUT_MESSAGE,
  classifyParseFailure,
  isDocumentParseError,
  toAttachmentErrorBody,
} from './errors';
import { ZipBombError } from './zipSafety';

describe('classifyParseFailure', () => {
  test('classifies ZipBombError as unpacked_too_large', () => {
    const error = classifyParseFailure(new ZipBombError('sample.docx: entry too large'), {
      filename: 'sample.docx',
    });

    expect(error).toBeInstanceOf(DocumentParseError);
    expect(error.errorCode).toBe(AttachmentErrorCodes.unpacked_too_large);
    expect(error.params).toEqual({ filename: 'sample.docx' });
  });

  test('classifies a PasswordException-shaped error as encrypted', () => {
    const passwordError = Object.assign(new Error('needs a password'), {
      name: 'PasswordException',
    });

    const error = classifyParseFailure(passwordError, { filename: 'secret.pdf' });

    expect(error.errorCode).toBe(AttachmentErrorCodes.encrypted);
    expect(error.params).toEqual({ filename: 'secret.pdf' });
  });

  test('classifies a generic error mentioning password as encrypted', () => {
    const error = classifyParseFailure(new Error('This document is password protected'), {
      filename: 'locked.docx',
    });

    expect(error.errorCode).toBe(AttachmentErrorCodes.encrypted);
  });

  test('classifies the timeout message as parse_timeout with seconds rounded up', () => {
    const error = classifyParseFailure(new Error(PARSE_TIMEOUT_MESSAGE), {
      filename: 'big.pdf',
      timeoutMs: 20,
    });

    expect(error.errorCode).toBe(AttachmentErrorCodes.parse_timeout);
    expect(error.params).toEqual({ filename: 'big.pdf', seconds: 1 });
  });

  test('classifies any other error as corrupted', () => {
    const error = classifyParseFailure(new Error('unexpected token at offset 12'), {
      filename: 'weird.docx',
    });

    expect(error.errorCode).toBe(AttachmentErrorCodes.corrupted);
    expect(error.params).toEqual({ filename: 'weird.docx' });
  });

  test('returns an existing DocumentParseError unchanged', () => {
    const original = new DocumentParseError(AttachmentErrorCodes.no_text, { filename: 'x.docx' });

    expect(classifyParseFailure(original, { filename: 'different.docx' })).toBe(original);
  });
});

describe('isDocumentParseError', () => {
  test('recognizes a real DocumentParseError instance', () => {
    expect(isDocumentParseError(new DocumentParseError(AttachmentErrorCodes.corrupted))).toBe(true);
  });

  test('recognizes a duck-typed error crossing a package boundary', () => {
    const crossPackageError = {
      name: 'DocumentParseError',
      errorCode: 'too_large',
      userErrorStatusCode: 422,
      message: 'too large',
    };

    expect(isDocumentParseError(crossPackageError)).toBe(true);
  });

  test('rejects a plain Error', () => {
    expect(isDocumentParseError(new Error('nope'))).toBe(false);
  });

  test('rejects an object with an unknown error code', () => {
    expect(
      isDocumentParseError({
        name: 'DocumentParseError',
        errorCode: 'not_a_real_code',
        userErrorStatusCode: 422,
      }),
    ).toBe(false);
  });

  test('rejects null and primitives', () => {
    expect(isDocumentParseError(null)).toBe(false);
    expect(isDocumentParseError(undefined)).toBe(false);
    expect(isDocumentParseError('DocumentParseError')).toBe(false);
  });
});

describe('toAttachmentErrorBody', () => {
  test('builds the wire body from the error code and params', () => {
    const error = new DocumentParseError(AttachmentErrorCodes.too_large, {
      filename: 'huge.pdf',
      limitMb: 50,
    });

    expect(toAttachmentErrorBody(error)).toEqual({
      message: '"huge.pdf" exceeds the 50 MB size limit.',
      errorCode: AttachmentErrorCodes.too_large,
      params: { filename: 'huge.pdf', limitMb: 50 },
    });
  });
});
