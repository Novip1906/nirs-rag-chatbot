import { AttachmentErrorCodes, createAttachmentErrorBody } from 'librechat-data-provider';
import type { Response } from 'express';
import { sendAttachmentError, writeAttachmentError } from './rejection';
import { DocumentParseError } from '../../files/documents/errors';

const createMockRes = (): jest.Mocked<Response> =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as jest.Mocked<Response>;

describe('writeAttachmentError', () => {
  it('sends the body as JSON with the given status when there is no SSE stream', () => {
    const res = createMockRes();
    const body = createAttachmentErrorBody(AttachmentErrorCodes.too_large, {
      filename: 'report.pdf',
      limitMb: 50,
    });

    writeAttachmentError(res, null, 422, body);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('emits the body over the SSE stream with the given status when one is active', () => {
    const res = createMockRes();
    const sseStream = { sendData: jest.fn(), sendError: jest.fn(), close: jest.fn() };
    const body = createAttachmentErrorBody(AttachmentErrorCodes.encrypted, {
      filename: 'secret.docx',
    });

    writeAttachmentError(res, sseStream, 422, body, {
      tempFileId: 'temp-1',
      toolResource: 'context',
    });

    expect(sseStream.sendError).toHaveBeenCalledWith({
      ...body,
      code: 422,
      temp_file_id: 'temp-1',
      tool_resource: 'context',
      display_to_user: true,
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('sendAttachmentError', () => {
  it('writes the typed body at the error status for a DocumentParseError', () => {
    const res = createMockRes();
    const error = new DocumentParseError(AttachmentErrorCodes.encrypted, {
      filename: 'secret.docx',
    });

    expect(sendAttachmentError(res, null, error)).toBe(true);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message: '"secret.docx" is password protected.',
      errorCode: 'encrypted',
      params: { filename: 'secret.docx' },
    });
  });

  it('emits the typed body over an active SSE stream', () => {
    const res = createMockRes();
    const sseStream = { sendData: jest.fn(), sendError: jest.fn(), close: jest.fn() };
    const error = new DocumentParseError(AttachmentErrorCodes.corrupted, {
      filename: 'broken.pdf',
    });

    expect(
      sendAttachmentError(res, sseStream, error, { tempFileId: 'temp-2', toolResource: 'context' }),
    ).toBe(true);
    expect(sseStream.sendError).toHaveBeenCalledWith({
      message: '"broken.pdf" could not be read — the file appears to be corrupted.',
      errorCode: 'corrupted',
      params: { filename: 'broken.pdf' },
      code: 422,
      temp_file_id: 'temp-2',
      tool_resource: 'context',
      display_to_user: true,
    });
  });

  it('leaves non-parse errors for the route-specific handler', () => {
    const res = createMockRes();

    expect(sendAttachmentError(res, null, new Error('provider failed'))).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
