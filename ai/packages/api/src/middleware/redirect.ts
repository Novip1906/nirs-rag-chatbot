import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { shouldUseSecureCookie } from '~/oauth/csrf';
import { isEnabled } from '~/utils';

const LOGIN_PATHS = new Set(['/', '/login']);
const OPENID_LOGIN_PATH = '/oauth/openid';

export const OPENID_REDIRECT_COOKIE = 'openid_redirect';
const OPENID_REDIRECT_COOKIE_MAX_AGE = 60 * 1000;

/**
 * Whether the OpenID strategy has everything it needs to run. Mirrors the
 * conditions the login page is served with, so the pre-login payload and the
 * server-side redirect cannot disagree about which providers exist.
 */
export function isOpenIDLoginEnabled(): boolean {
  return (
    !!process.env.OPENID_CLIENT_ID &&
    (isEnabled(process.env.OPENID_USE_PKCE) || !!process.env.OPENID_CLIENT_SECRET?.trim()) &&
    !!process.env.OPENID_ISSUER &&
    !!process.env.OPENID_SESSION_SECRET
  );
}

const isNavigation = (req: Request): boolean =>
  req.method === 'GET' && String(req.headers?.accept ?? '').includes('text/html');

/**
 * A refresh cookie outlives the session it belongs to: it stays in the browser
 * after the session expires and after a logout that never reached the browser.
 * Treating its mere presence as proof of a session hands those visitors the SPA,
 * which then bounces them to the provider itself — the flash this middleware
 * exists to remove. Verifying the signature costs no database round trip and
 * tells expired from live.
 */
const hasSession = (req: Request): boolean => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return false;
  }

  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    return true;
  }

  try {
    jwt.verify(refreshToken, secret);
    return true;
  } catch {
    return false;
  }
};

/**
 * Sends anonymous visitors to the OpenID provider before the SPA is served.
 *
 * The client-side auto-redirect renders the login page first and only then
 * navigates away, so the visitor sees a welcome screen flash by on every
 * unauthenticated visit. Answering with a 302 removes that intermediate screen.
 *
 * Deliberately inert when the visitor already holds a session cookie, when the
 * login page carries an error (redirecting would loop back into the failure),
 * when a deep link has to be stored by the client first, and when the
 * `?redirect=false` escape hatch is used to reach the email form.
 *
 * At most one hop per visitor: the session cookie is `SameSite=Strict`, so the
 * browser may withhold it on the navigation that follows the provider's
 * redirect back. A short-lived marker cookie keeps that case from bouncing
 * between the app and the provider — the SPA is served instead and restores the
 * session over XHR, where the cookie is sent.
 */
export function openidLoginRedirect(req: Request, res: Response, next: NextFunction): void {
  if (!isEnabled(process.env.OPENID_AUTO_REDIRECT) || !isEnabled(process.env.ALLOW_SOCIAL_LOGIN)) {
    return next();
  }
  if (!isOpenIDLoginEnabled() || !isNavigation(req) || !LOGIN_PATHS.has(req.path)) {
    return next();
  }
  if (hasSession(req)) {
    return next();
  }

  const query = req.query ?? {};
  if (query.redirect === 'false' || query.error != null || query.redirect_to != null) {
    return next();
  }

  if (req.cookies?.[OPENID_REDIRECT_COOKIE]) {
    res.clearCookie(OPENID_REDIRECT_COOKIE);
    return next();
  }

  res.cookie(OPENID_REDIRECT_COOKIE, '1', {
    maxAge: OPENID_REDIRECT_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
  });

  return res.redirect(302, OPENID_LOGIN_PATH);
}
