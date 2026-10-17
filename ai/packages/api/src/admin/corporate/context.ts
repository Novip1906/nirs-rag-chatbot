import type { ServerRequest } from '~/types/http';

export function requestUserId(req: ServerRequest): string {
  return req.user?._id?.toString() ?? req.user?.id ?? '';
}
