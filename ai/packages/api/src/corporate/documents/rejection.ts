import type { AttachmentErrorBody } from 'librechat-data-provider';
import type { Response } from 'express';
import type { UploadPolicyErrorContext, UploadSseStream } from '~/files/sse';
import { isDocumentParseError, toAttachmentErrorBody } from '../../files/documents/errors';

export function writeAttachmentError(
  res: Response,
  sseStream: UploadSseStream | null | undefined,
  status: number,
  body: AttachmentErrorBody,
  context: UploadPolicyErrorContext = {},
): void {
  if (sseStream) {
    sseStream.sendError({
      ...body,
      code: status,
      temp_file_id: context.tempFileId,
      tool_resource: context.toolResource,
      display_to_user: true,
    });
    return;
  }
  res.status(status).json(body);
}

export function sendAttachmentError(
  res: Response,
  sseStream: UploadSseStream | null | undefined,
  error: unknown,
  context: UploadPolicyErrorContext = {},
): boolean {
  if (!isDocumentParseError(error)) {
    return false;
  }
  writeAttachmentError(
    res,
    sseStream,
    error.userErrorStatusCode,
    toAttachmentErrorBody(error),
    context,
  );
  return true;
}
