import { looksLikeUnexpectedResponseBody } from '../errors';

describe('looksLikeUnexpectedResponseBody', () => {
  it('flags an HTML error page from a proxy (nginx 503, load balancer timeout)', () => {
    const nginxPage =
      '<html>\r\n<head><title>503 Service Temporarily Unavailable</title></head>\r\n' +
      '<body>\r\n<center><h1>503 Service Temporarily Unavailable</h1></center>\r\n' +
      '<hr><center>nginx</center>\r\n</body>\r\n</html>';

    expect(looksLikeUnexpectedResponseBody(nginxPage)).toBe(true);
  });

  it('flags an HTML page even with leading whitespace before the tag', () => {
    expect(looksLikeUnexpectedResponseBody('\n  <!DOCTYPE html><html></html>')).toBe(true);
  });

  it('flags an empty or whitespace-only body', () => {
    expect(looksLikeUnexpectedResponseBody('')).toBe(true);
    expect(looksLikeUnexpectedResponseBody('   \n\t ')).toBe(true);
  });

  it('flags a missing body', () => {
    expect(looksLikeUnexpectedResponseBody(null)).toBe(true);
    expect(looksLikeUnexpectedResponseBody(undefined)).toBe(true);
  });

  it('does not flag a real JSON error payload', () => {
    expect(looksLikeUnexpectedResponseBody('{"error":"token_limit"}')).toBe(false);
  });

  it('does not flag plain text that is not markup', () => {
    expect(looksLikeUnexpectedResponseBody('daily limit exceeded')).toBe(false);
  });
});
