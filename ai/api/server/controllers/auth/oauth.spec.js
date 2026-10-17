const mockIsEnabled = jest.fn();
const mockGetAdminPanelUrl = jest.fn();
const mockIsAdminPanelRedirect = jest.fn();
const mockGenerateAdminExchangeCode = jest.fn();
const mockSyncUserEntraGroupMemberships = jest.fn();
const mockSetAuthTokens = jest.fn();
const mockSetOpenIDAuthTokens = jest.fn();
const mockGetLogStores = jest.fn();
const mockCheckBan = jest.fn();
const mockGenerateToken = jest.fn();
const mockShouldUseSecureCookie = jest.fn();
const mockLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };

jest.mock('librechat-data-provider', () => ({
  CacheKeys: { ADMIN_OAUTH_EXCHANGE: 'admin-oauth-exchange' },
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
  DEFAULT_SESSION_EXPIRY: 60000,
  DEFAULT_REFRESH_TOKEN_EXPIRY: 604800000,
}));

jest.mock('@librechat/api', () => {
  const { math: actualMath } = jest.requireActual('../../../../packages/api/src/utils/math');

  function getAdminSessionExpiry() {
    const sessionExpiry = actualMath(process.env.SESSION_EXPIRY, 60000);
    const raw = process.env.ADMIN_SESSION_EXPIRY;
    if (raw == null || raw === '') {
      return sessionExpiry;
    }
    try {
      const adminSessionExpiry = actualMath(raw);
      if (adminSessionExpiry > 0) {
        return adminSessionExpiry;
      }
      mockLogger.warn('invalid ADMIN_SESSION_EXPIRY');
    } catch {
      mockLogger.warn('invalid ADMIN_SESSION_EXPIRY');
    }
    return sessionExpiry;
  }

  return {
    math: actualMath,
    getAdminSessionExpiry,
    isEnabled: (...args) => mockIsEnabled(...args),
    getAdminPanelUrl: (...args) => mockGetAdminPanelUrl(...args),
    isAdminPanelRedirect: (...args) => mockIsAdminPanelRedirect(...args),
    generateAdminExchangeCode: (...args) => mockGenerateAdminExchangeCode(...args),
    shouldUseSecureCookie: (...args) => mockShouldUseSecureCookie(...args),
  };
});

jest.mock('~/server/services/PermissionService', () => ({
  syncUserEntraGroupMemberships: (...args) => mockSyncUserEntraGroupMemberships(...args),
}));

jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: (...args) => mockSetAuthTokens(...args),
  setOpenIDAuthTokens: (...args) => mockSetOpenIDAuthTokens(...args),
}));

jest.mock(
  '~/cache/getLogStores',
  () =>
    (...args) =>
      mockGetLogStores(...args),
);

jest.mock('~/server/middleware', () => ({
  checkBan: (...args) => mockCheckBan(...args),
}));

jest.mock('~/models', () => ({
  generateToken: (...args) => mockGenerateToken(...args),
}));

const { createOAuthHandler } = require('./oauth');

const ORIGINAL_ENV = process.env;

function buildReq(overrides = {}) {
  return {
    user: {
      _id: 'user-123',
      email: 'admin@example.com',
      provider: 'openid',
      tokenset: { refresh_token: 'openid-refresh-token', access_token: 'openid-access-token' },
      federatedTokens: { refresh_token: 'federated-refresh-token' },
    },
    pkceChallenge: 'pkce-challenge',
    banned: false,
    ...overrides,
  };
}

function buildRes() {
  return {
    headersSent: false,
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

describe('createOAuthHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      DOMAIN_CLIENT: 'http://localhost:3080',
      DOMAIN_SERVER: 'http://localhost:3080',
      OPENID_REUSE_TOKENS: 'false',
    };
    delete process.env.SESSION_EXPIRY;
    delete process.env.ADMIN_SESSION_EXPIRY;
    delete process.env.REFRESH_TOKEN_EXPIRY;
    mockIsEnabled.mockImplementation((value) => value === 'true' || value === true);
    mockGetAdminPanelUrl.mockReturnValue('http://admin.example.com');
    mockIsAdminPanelRedirect.mockReturnValue(true);
    mockGetLogStores.mockReturnValue({});
    mockCheckBan.mockResolvedValue(undefined);
    mockGenerateToken.mockResolvedValue('jwt-token');
    mockGenerateAdminExchangeCode.mockResolvedValue('exchange-code');
    mockShouldUseSecureCookie.mockReturnValue(true);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('omits refresh token from admin exchange when OPENID_REUSE_TOKENS is disabled', async () => {
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateAdminExchangeCode).toHaveBeenCalledWith(
      {},
      req.user,
      'jwt-token',
      undefined,
      'http://admin.example.com',
      'pkce-challenge',
      expect.any(Number),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'http://admin.example.com/auth/openid/callback?code=exchange-code',
    );
    expect(mockSetOpenIDAuthTokens).not.toHaveBeenCalled();
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('includes refresh token in admin exchange when OPENID_REUSE_TOKENS is enabled', async () => {
    process.env.OPENID_REUSE_TOKENS = 'true';
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateAdminExchangeCode).toHaveBeenCalledWith(
      {},
      req.user,
      'jwt-token',
      'openid-refresh-token',
      'http://admin.example.com',
      'pkce-challenge',
      expect.any(Number),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'http://admin.example.com/auth/openid/callback?code=exchange-code',
    );
    expect(mockSetOpenIDAuthTokens).not.toHaveBeenCalled();
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards the refresh token from req.authInfo for non-openid admin providers', async () => {
    const handler = createOAuthHandler('http://admin.example.com/auth/google/callback');
    const req = buildReq({
      user: { _id: 'user-9', email: 'g@example.com', provider: 'google' },
      authInfo: { refreshToken: 'google-refresh-token' },
    });
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateAdminExchangeCode).toHaveBeenCalledWith(
      {},
      req.user,
      'jwt-token',
      'google-refresh-token',
      'http://admin.example.com',
      'pkce-challenge',
      expect.any(Number),
    );
  });

  it('omits the refresh token when a non-openid admin login has no authInfo', async () => {
    const handler = createOAuthHandler('http://admin.example.com/auth/google/callback');
    const req = buildReq({
      user: { _id: 'user-9', email: 'g@example.com', provider: 'google' },
    });
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateAdminExchangeCode).toHaveBeenCalledWith(
      {},
      req.user,
      'jwt-token',
      undefined,
      'http://admin.example.com',
      'pkce-challenge',
      expect.any(Number),
    );
  });

  it('mints the admin exchange token with SESSION_EXPIRY when ADMIN_SESSION_EXPIRY is unset', async () => {
    delete process.env.ADMIN_SESSION_EXPIRY;
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    const before = Date.now();
    await handler(req, res, next);
    const after = Date.now();

    expect(mockGenerateToken).toHaveBeenCalledWith(req.user, 60000);
    const expiresAt = mockGenerateAdminExchangeCode.mock.calls[0][6];
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60000);
    expect(expiresAt).toBeLessThanOrEqual(after + 60000);
  });

  it('mints the admin exchange token with ADMIN_SESSION_EXPIRY when set', async () => {
    process.env.ADMIN_SESSION_EXPIRY = '120000';
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    const before = Date.now();
    await handler(req, res, next);
    const after = Date.now();

    expect(mockGenerateToken).toHaveBeenCalledWith(req.user, 120000);
    const expiresAt = mockGenerateAdminExchangeCode.mock.calls[0][6];
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120000);
    expect(expiresAt).toBeLessThanOrEqual(after + 120000);
  });

  it('mints the admin exchange token with an evaluated ADMIN_SESSION_EXPIRY expression', async () => {
    process.env.ADMIN_SESSION_EXPIRY = '1000 * 60 * 60 * 8';
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateToken).toHaveBeenCalledWith(req.user, 1000 * 60 * 60 * 8);
  });

  it('falls back to SESSION_EXPIRY and warns when ADMIN_SESSION_EXPIRY is garbage', async () => {
    process.env.ADMIN_SESSION_EXPIRY = '8h';
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateToken).toHaveBeenCalledWith(req.user, 60000);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('falls back to SESSION_EXPIRY and warns when ADMIN_SESSION_EXPIRY is zero or negative', async () => {
    process.env.ADMIN_SESSION_EXPIRY = '0';
    const handler = createOAuthHandler('http://admin.example.com/auth/openid/callback');
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateToken).toHaveBeenCalledWith(req.user, 60000);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('does not forward refresh tokens for admin providers other than google or openid', async () => {
    const handler = createOAuthHandler('http://admin.example.com/auth/discord/callback');
    const req = buildReq({
      user: { _id: 'user-9', email: 'd@example.com', provider: 'discord' },
      authInfo: { refreshToken: 'discord-refresh-token' },
    });
    const res = buildRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockGenerateAdminExchangeCode).toHaveBeenCalledWith(
      {},
      req.user,
      'jwt-token',
      undefined,
      'http://admin.example.com',
      'pkce-challenge',
      expect.any(Number),
    );
  });

  describe('standard OAuth flow (chat)', () => {
    beforeEach(() => {
      mockIsAdminPanelRedirect.mockReturnValue(false);
      mockSetAuthTokens.mockResolvedValue('chat-jwt');
    });

    it('sets the openid_id_token cookie after setAuthTokens when OPENID_REUSE_TOKENS is disabled', async () => {
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { id_token: 'openid-id-token', access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(mockSetAuthTokens).toHaveBeenCalledWith('user-123', res, null, req);
      expect(res.cookie).toHaveBeenCalledWith(
        'openid_id_token',
        'openid-id-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          expires: expect.any(Date),
        }),
      );
      expect(mockSetOpenIDAuthTokens).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3080/');
    });

    it('sets the openid_id_token cookie with the REFRESH_TOKEN_EXPIRY duration', async () => {
      process.env.REFRESH_TOKEN_EXPIRY = '1000 * 60 * 60 * 24 * 3';
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { id_token: 'openid-id-token', access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      const before = Date.now();
      await handler(req, res, next);
      const after = Date.now();

      const [, , options] = res.cookie.mock.calls[0];
      const expiryMs = 1000 * 60 * 60 * 24 * 3;
      expect(options.expires.getTime()).toBeGreaterThanOrEqual(before + expiryMs);
      expect(options.expires.getTime()).toBeLessThanOrEqual(after + expiryMs);
      expect(options.path).toBeUndefined();
    });

    it('does not set the openid_id_token cookie when the tokenset has no id_token', async () => {
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('clears a stale openid_id_token cookie when the new tokenset has no id_token', async () => {
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('openid_id_token');
    });

    it('does not change the chat token expiry when ADMIN_SESSION_EXPIRY is set', async () => {
      process.env.ADMIN_SESSION_EXPIRY = '999999999';
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(mockSetAuthTokens).toHaveBeenCalledWith('user-123', res, null, req);
    });

    it('does not set the openid_id_token cookie for non-openid providers', async () => {
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: { _id: 'user-9', email: 'g@example.com', provider: 'google' },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('does not set the openid_id_token cookie when OPENID_REUSE_TOKENS is enabled', async () => {
      process.env.OPENID_REUSE_TOKENS = 'true';
      const handler = createOAuthHandler('http://localhost:3080/');
      const req = buildReq({
        user: {
          _id: 'user-123',
          email: 'user@example.com',
          provider: 'openid',
          tokenset: { id_token: 'openid-id-token', access_token: 'openid-access-token' },
        },
      });
      const res = buildRes();
      const next = jest.fn();

      await handler(req, res, next);

      expect(mockSetOpenIDAuthTokens).toHaveBeenCalled();
      expect(mockSetAuthTokens).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });
});
