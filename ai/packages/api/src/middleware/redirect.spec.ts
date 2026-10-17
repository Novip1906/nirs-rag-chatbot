import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { OPENID_REDIRECT_COOKIE, isOpenIDLoginEnabled, openidLoginRedirect } from './redirect';

describe('openidLoginRedirect', () => {
  const originalEnv = { ...process.env };
  let req: Partial<Request>;
  let res: { redirect: jest.Mock; cookie: jest.Mock; clearCookie: jest.Mock };
  let next: NextFunction;

  const buildRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
    method: 'GET',
    path: '/',
    query: {},
    cookies: {},
    headers: { accept: 'text/html,application/xhtml+xml' },
    ...overrides,
  });

  beforeEach(() => {
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    process.env.OPENID_AUTO_REDIRECT = 'true';
    process.env.OPENID_CLIENT_ID = 'librechat';
    process.env.OPENID_CLIENT_SECRET = 'secret';
    process.env.OPENID_ISSUER = 'https://auth.example.com/realms/test';
    process.env.OPENID_SESSION_SECRET = 'session-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    delete process.env.OPENID_USE_PKCE;

    req = buildRequest();
    res = { redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn() };
    next = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const run = () => openidLoginRedirect(req as Request, res as unknown as Response, next);

  it('redirects an anonymous visitor on the root path straight to the provider', () => {
    run();

    expect(res.redirect).toHaveBeenCalledWith(302, '/oauth/openid');
    expect(next).not.toHaveBeenCalled();
  });

  it('marks the hop so a withheld session cookie cannot bounce the visitor', () => {
    run();

    expect(res.cookie).toHaveBeenCalledWith(
      OPENID_REDIRECT_COOKIE,
      '1',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('serves the SPA instead of redirecting a second time', () => {
    req = buildRequest({ cookies: { [OPENID_REDIRECT_COOKIE]: '1' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith(OPENID_REDIRECT_COOKIE);
    expect(next).toHaveBeenCalled();
  });

  it('redirects an anonymous visitor on the login path', () => {
    req = buildRequest({ path: '/login' });

    run();

    expect(res.redirect).toHaveBeenCalledWith(302, '/oauth/openid');
  });

  it('leaves a visitor with a live session to the SPA', () => {
    const refreshToken = jwt.sign({ id: 'user' }, 'refresh-secret', { expiresIn: '1h' });
    req = buildRequest({ cookies: { refreshToken } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('redirects a visitor whose refresh cookie has expired', () => {
    const refreshToken = jwt.sign({ id: 'user' }, 'refresh-secret', { expiresIn: '-1h' });
    req = buildRequest({ cookies: { refreshToken } });

    run();

    expect(res.redirect).toHaveBeenCalledWith(302, '/oauth/openid');
  });

  it('redirects a visitor whose refresh cookie was not signed by this server', () => {
    const refreshToken = jwt.sign({ id: 'user' }, 'someone-elses-secret', { expiresIn: '1h' });
    req = buildRequest({ cookies: { refreshToken } });

    run();

    expect(res.redirect).toHaveBeenCalledWith(302, '/oauth/openid');
  });

  it('leaves the cookie alone when the server cannot verify it', () => {
    delete process.env.JWT_REFRESH_SECRET;
    req = buildRequest({ cookies: { refreshToken: 'opaque-provider-token' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('honours the ?redirect=false escape hatch', () => {
    req = buildRequest({ path: '/login', query: { redirect: 'false' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('does not redirect a failed login back into the provider', () => {
    req = buildRequest({ path: '/login', query: { error: 'auth_failed' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('leaves a deep link to the client so it can store the return path', () => {
    req = buildRequest({ path: '/login', query: { redirect_to: '/c/abc' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('ignores non-navigation requests', () => {
    req = buildRequest({ headers: { accept: 'application/json' } });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('ignores requests that are not GET', () => {
    req = buildRequest({ method: 'POST' });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('ignores paths other than the login entry points', () => {
    req = buildRequest({ path: '/c/new' });

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('stays inert when auto redirect is disabled', () => {
    process.env.OPENID_AUTO_REDIRECT = 'false';

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('stays inert when social logins are disabled', () => {
    delete process.env.ALLOW_SOCIAL_LOGIN;

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('stays inert when OpenID is not configured', () => {
    delete process.env.OPENID_ISSUER;

    run();

    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('isOpenIDLoginEnabled', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENID_CLIENT_ID = 'librechat';
    process.env.OPENID_ISSUER = 'https://auth.example.com/realms/test';
    process.env.OPENID_SESSION_SECRET = 'session-secret';
    delete process.env.OPENID_CLIENT_SECRET;
    delete process.env.OPENID_USE_PKCE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts a client secret as the credential', () => {
    process.env.OPENID_CLIENT_SECRET = 'secret';

    expect(isOpenIDLoginEnabled()).toBe(true);
  });

  it('accepts PKCE instead of a client secret', () => {
    process.env.OPENID_USE_PKCE = 'true';

    expect(isOpenIDLoginEnabled()).toBe(true);
  });

  it('rejects a blank client secret without PKCE', () => {
    process.env.OPENID_CLIENT_SECRET = '   ';

    expect(isOpenIDLoginEnabled()).toBe(false);
  });

  it('rejects a configuration without an issuer', () => {
    process.env.OPENID_CLIENT_SECRET = 'secret';
    delete process.env.OPENID_ISSUER;

    expect(isOpenIDLoginEnabled()).toBe(false);
  });
});
