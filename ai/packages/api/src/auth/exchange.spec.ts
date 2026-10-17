import crypto from 'crypto';
import { Keyv } from 'keyv';
import { Types } from 'mongoose';
import type { IUser } from '@librechat/data-schemas';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
  },
  DEFAULT_SESSION_EXPIRY: 1000 * 60 * 15,
}));

import { logger } from '@librechat/data-schemas';
import {
  exchangeAdminCode,
  generateAdminExchangeCode,
  getAdminSessionExpiry,
  isAdminPanelRedirect,
  serializeUserForExchange,
  verifyCodeChallenge,
} from './exchange';

describe('admin OAuth code exchange', () => {
  const user = {
    _id: 'user123',
    email: 'admin@example.com',
    name: 'Admin User',
    username: 'admin',
    role: 'ADMIN',
    provider: 'openid',
  } as unknown as IUser;

  const createCache = () => {
    const cache = new Keyv();
    const deleteSpy = jest.spyOn(cache, 'delete');
    return { cache, deleteSpy };
  };

  describe('origin binding', () => {
    it('exchanges code when request origin matches generated origin', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
      );

      const result = await exchangeAdminCode(cache, exchangeCode, 'https://admin.example.com');

      expect(result).not.toBeNull();
      expect(result!.token).toBe('jwt-token');
      expect(result!.refreshToken).toBe('refresh-token');
      expect(result!.user.email).toBe('admin@example.com');
    });

    it('rejects code exchange when request origin does not match generated origin', async () => {
      const { cache, deleteSpy } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
      );

      const result = await exchangeAdminCode(cache, exchangeCode, 'https://evil.example.com');

      expect(result).toBeNull();
      expect(deleteSpy).toHaveBeenCalledWith(exchangeCode);
      await expect(cache.get(exchangeCode)).resolves.toBeUndefined();
    });

    it('rejects code exchange when origin is stored but request has no origin', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
      );

      const result = await exchangeAdminCode(cache, exchangeCode, undefined);

      expect(result).toBeNull();
    });

    it('allows exchange when no origin was stored (backward compat)', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
      );

      const result = await exchangeAdminCode(cache, exchangeCode, 'https://any-origin.com');

      expect(result).not.toBeNull();
      expect(result!.token).toBe('jwt-token');
    });
  });

  describe('one-time use', () => {
    it('rejects code that has already been used', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
      );

      await exchangeAdminCode(cache, exchangeCode, 'https://admin.example.com');
      const secondAttempt = await exchangeAdminCode(
        cache,
        exchangeCode,
        'https://admin.example.com',
      );

      expect(secondAttempt).toBeNull();
    });
  });

  describe('PKCE verification', () => {
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');

    it('verifyCodeChallenge returns true for matching verifier', () => {
      expect(verifyCodeChallenge(codeVerifier, codeChallenge)).toBe(true);
    });

    it('verifyCodeChallenge returns false for wrong verifier', () => {
      expect(verifyCodeChallenge('wrong-verifier', codeChallenge)).toBe(false);
    });

    it('verifyCodeChallenge handles hex case insensitively (input gate rejects uppercase)', () => {
      const uppercaseChallenge = codeChallenge.toUpperCase();
      // Buffer.from(hex) is case-insensitive, so verification passes at this layer.
      // Uppercase challenges are rejected earlier by PKCE_CHALLENGE_PATTERN (no /i flag).
      expect(verifyCodeChallenge(codeVerifier, uppercaseChallenge)).toBe(true);
    });

    it('exchanges code when valid code_verifier is provided', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
        codeChallenge,
      );

      const result = await exchangeAdminCode(
        cache,
        exchangeCode,
        'https://admin.example.com',
        codeVerifier,
      );

      expect(result).not.toBeNull();
      expect(result!.token).toBe('jwt-token');
    });

    it('rejects exchange when code_verifier does not match challenge', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
        codeChallenge,
      );

      const result = await exchangeAdminCode(
        cache,
        exchangeCode,
        'https://admin.example.com',
        'wrong-verifier',
      );

      expect(result).toBeNull();
    });

    it('rejects exchange when challenge stored but no verifier provided', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
        codeChallenge,
      );

      const result = await exchangeAdminCode(cache, exchangeCode, 'https://admin.example.com');

      expect(result).toBeNull();
    });

    it('allows exchange when no challenge stored and no verifier sent (backward compat)', async () => {
      const { cache } = createCache();
      const exchangeCode = await generateAdminExchangeCode(
        cache,
        user,
        'jwt-token',
        'refresh-token',
        'https://admin.example.com',
      );

      const result = await exchangeAdminCode(cache, exchangeCode, 'https://admin.example.com');

      expect(result).not.toBeNull();
      expect(result!.token).toBe('jwt-token');
    });
  });

  describe('isAdminPanelRedirect', () => {
    it('returns true for cross-origin admin callback redirects', () => {
      expect(
        isAdminPanelRedirect(
          'https://admin.example.com/auth/openid/callback',
          'https://admin.example.com',
          'https://chat.example.com',
        ),
      ).toBe(true);
    });

    it('returns true for same-origin callbacks under the admin subpath', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/admin/auth/openid/callback',
          'https://chat.example.com/admin',
          'https://chat.example.com',
        ),
      ).toBe(true);
    });

    it('returns false for same-origin callbacks outside the admin subpath', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/oauth/openid/callback',
          'https://chat.example.com/admin',
          'https://chat.example.com',
        ),
      ).toBe(false);
    });

    it('does not treat similarly prefixed paths as admin subpaths', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/administrator/auth/openid/callback',
          'https://chat.example.com/admin',
          'https://chat.example.com',
        ),
      ).toBe(false);
    });

    it('treats trailing slash variants of admin subpath as equivalent', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/admin/auth/openid/callback',
          'https://chat.example.com/admin/',
          'https://chat.example.com',
        ),
      ).toBe(true);
    });

    it('returns true when redirect path exactly matches admin subpath', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/admin',
          'https://chat.example.com/admin',
          'https://chat.example.com',
        ),
      ).toBe(true);
    });

    it('returns false for same-origin root admin URL', () => {
      expect(
        isAdminPanelRedirect(
          'https://chat.example.com/auth/openid/callback',
          'https://chat.example.com/',
          'https://chat.example.com',
        ),
      ).toBe(false);
    });
  });
});

describe('serializeUserForExchange', () => {
  it('carries the stable employee id to the admin panel', () => {
    const user = {
      _id: new Types.ObjectId(),
      email: 'alice@example.com',
      name: 'Alice',
      role: 'ADMIN',
      employeeId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    } as unknown as IUser;

    expect(serializeUserForExchange(user).employeeId).toBe(
      '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    );
  });
});

describe('getAdminSessionExpiry', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SESSION_EXPIRY;
    delete process.env.ADMIN_SESSION_EXPIRY;
    (logger.warn as jest.Mock).mockClear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falls back to the default SESSION_EXPIRY when neither var is set', () => {
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 15);
  });

  it('falls back to SESSION_EXPIRY (evaluated, not just numeric) when ADMIN_SESSION_EXPIRY is unset', () => {
    process.env.SESSION_EXPIRY = '1000 * 60 * 30';
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 30);
  });

  it('evaluates an arithmetic expression for ADMIN_SESSION_EXPIRY', () => {
    process.env.ADMIN_SESSION_EXPIRY = '1000 * 60 * 60 * 8';
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 60 * 8);
  });

  it('falls back to SESSION_EXPIRY and warns on a non-numeric ADMIN_SESSION_EXPIRY', () => {
    process.env.SESSION_EXPIRY = '1000 * 60 * 30';
    process.env.ADMIN_SESSION_EXPIRY = '8h';
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 30);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[getAdminSessionExpiry]'));
  });

  it('falls back to SESSION_EXPIRY and warns when ADMIN_SESSION_EXPIRY is zero', () => {
    process.env.SESSION_EXPIRY = '1000 * 60 * 30';
    process.env.ADMIN_SESSION_EXPIRY = '0';
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 30);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[getAdminSessionExpiry]'));
  });

  it('falls back to SESSION_EXPIRY and warns when ADMIN_SESSION_EXPIRY is negative', () => {
    process.env.SESSION_EXPIRY = '1000 * 60 * 30';
    process.env.ADMIN_SESSION_EXPIRY = '-1000';
    expect(getAdminSessionExpiry()).toBe(1000 * 60 * 30);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[getAdminSessionExpiry]'));
  });

  it('does not warn when ADMIN_SESSION_EXPIRY is a valid positive expression', () => {
    process.env.ADMIN_SESSION_EXPIRY = '1000 * 60 * 60';
    getAdminSessionExpiry();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
