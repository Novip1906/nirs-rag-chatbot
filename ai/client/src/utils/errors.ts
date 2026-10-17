import axios from 'axios';

/**
 * Returns the HTTP response status code from an error, regardless of the
 * HTTP client used.  Handles Axios errors first, then falls back to checking
 * for a plain `status` property so callers never need to import axios.
 */
export const getResponseStatus = (error: unknown): number | undefined => {
  if (axios.isAxiosError(error)) {
    return error.response?.status;
  }
  if (error != null && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status: unknown };
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
};

export const isNotFoundError = (error: unknown): boolean => getResponseStatus(error) === 404;

/**
 * A legitimate SSE error payload from this app's own server is always JSON, or empty.
 * A non-empty body that isn't JSON and looks like markup never came from the app at
 * all — it's a gateway's own error page (nginx 502/503, a load balancer timeout screen)
 * that the request never got past. During a deploy an employee once saw exactly that
 * page's raw HTML as the assistant's answer in the chat window, because the SSE error
 * handler fell back to displaying the unparsed body verbatim instead of recognizing it
 * as unexpected. Meaningful server errors (limit exceeded, blocked account, model
 * unavailable) are always valid JSON and never hit this check.
 */
export function looksLikeUnexpectedResponseBody(raw: string | null | undefined): boolean {
  if (raw == null) {
    return true;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return true;
  }
  return trimmed.startsWith('<');
}
