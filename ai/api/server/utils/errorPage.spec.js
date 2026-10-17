const { renderErrorPage, sendRateLimitResponse, wantsHtmlResponse } = require('./errorPage');

function mockRequest(headers = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name) => lower[name.toLowerCase()] };
}

function mockResponse() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.type = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('wantsHtmlResponse', () => {
  it('is true for a top-level browser navigation', () => {
    const req = mockRequest({
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    expect(wantsHtmlResponse(req)).toBe(true);
  });

  /**
   * Клиент шлёт `fetch` (по умолчанию `*`) и axios (`application/json, text/plain, *`) —
   * им обоим нужен прежний JSON, иначе разбор ответа на фронте сломается.
   */
  it('is false for the fetch and axios defaults', () => {
    expect(wantsHtmlResponse(mockRequest({ accept: '*/*' }))).toBe(false);
    expect(wantsHtmlResponse(mockRequest({ accept: 'application/json, text/plain, */*' }))).toBe(
      false,
    );
    expect(wantsHtmlResponse(mockRequest())).toBe(false);
  });

  it('is false for an explicit XHR', () => {
    expect(wantsHtmlResponse({ xhr: true, get: () => 'text/html' })).toBe(false);
  });
});

describe('sendRateLimitResponse', () => {
  it('keeps the JSON body unchanged for API clients', () => {
    const res = mockResponse();
    sendRateLimitResponse(mockRequest({ accept: '*/*' }), res, {
      message: 'Too many login attempts, please try again after 5 minutes.',
      windowInMinutes: 5,
    });

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Too many login attempts, please try again after 5 minutes.',
    });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('answers a browser with a branded HTML page and a way back to sign-in', () => {
    process.env.DOMAIN_CLIENT = 'https://ai.example.test';
    const res = mockResponse();
    sendRateLimitResponse(mockRequest({ accept: 'text/html' }), res, {
      message: 'Too many login attempts, please try again after 5 minutes.',
      windowInMinutes: 5,
    });

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.type).toHaveBeenCalledWith('html');
    const html = res.send.mock.calls[0][0];
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Слишком много попыток входа');
    expect(html).toContain('Попробуйте снова через 5 мин.');
    expect(html).toContain('https://ai.example.test/login');
    expect(html).toContain('/assets/logo.svg');
  });

  it('answers in English when the browser asks for it', () => {
    const res = mockResponse();
    sendRateLimitResponse(
      mockRequest({ accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' }),
      res,
      { message: 'Too many login attempts', windowInMinutes: 5 },
    );

    const html = res.send.mock.calls[0][0];
    expect(html).toContain('lang="en"');
    expect(html).toContain('Too many sign-in attempts');
    expect(html).toContain('Try again in 5 min.');
  });
});

describe('renderErrorPage', () => {
  it('escapes the text it is given instead of injecting it as markup', () => {
    const html = renderErrorPage({
      lang: 'ru',
      title: '<script>alert(1)</script>',
      description: 'a & b',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
});
