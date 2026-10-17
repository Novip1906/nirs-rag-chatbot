const express = require('express');
const request = require('supertest');

jest.mock('passport', () => ({
  authenticate: jest.fn(() => (req, res, next) => next()),
  _strategy: jest.fn(),
}));

jest.mock('librechat-data-provider', () => ({
  CacheKeys: { ADMIN_OAUTH_EXCHANGE: 'admin-oauth-exchange' },
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  SystemCapabilities: { ACCESS_ADMIN: 'ACCESS_ADMIN' },
}));

jest.mock('@librechat/api', () => ({
  getAdminPanelUrl: jest.fn(() => 'http://admin.example.com'),
  createSetBalanceConfig: jest.fn(() => (req, res, next) => next()),
  storeAndStripChallenge: jest.fn(),
  tenantContextMiddleware: jest.fn((req, res, next) => next()),
}));

jest.mock('~/server/controllers/auth/LoginController', () => ({
  loginController: jest.fn((req, res) => res.status(200).end()),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: jest.fn(() => (req, res, next) => next()),
}));

jest.mock('~/server/controllers/auth/oauth', () => ({
  createOAuthHandler: jest.fn(() => (req, res) => res.status(200).end()),
}));

jest.mock('~/models', () => ({
  findBalanceByUser: jest.fn(),
  upsertBalanceFields: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('~/cache/getLogStores', () =>
  jest.fn(() => ({
    get: jest.fn(),
    delete: jest.fn(),
  })),
);

jest.mock('~/server/middleware', () => ({
  logHeaders: jest.fn((req, res, next) => next()),
  loginLimiter: jest.fn((req, res, next) => next()),
  checkBan: jest.fn((req, res, next) => next()),
  validateEmailLogin: jest.fn((req, res, next) => next()),
  requireLocalAuth: jest.fn((req, res, next) => next()),
  requireJwtAuth: jest.fn((req, res, next) => next()),
  checkDomainAllowed: jest.fn((req, res, next) => next()),
}));

const passport = require('passport');
const { storeAndStripChallenge } = require('@librechat/api');
const middleware = require('~/server/middleware');
const adminAuthRouter = require('./auth');

describe('admin auth removed sign-in routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    passport._strategy.mockReturnValue({});

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminAuthRouter);
  });

  it.each([
    ['get', '/api/admin/oauth/openid'],
    ['get', '/api/admin/oauth/openid/check'],
    ['get', '/api/admin/oauth/openid/callback?state=state'],
    ['post', '/api/admin/oauth/exchange'],
    ['post', '/api/admin/oauth/refresh'],
  ])('%s %s is not served', async (method, url) => {
    const response = await request(app)[method](url).send({ code: 'x', refresh_token: 'y' });

    expect(response.status).toBe(404);
    expect(passport.authenticate).not.toHaveBeenCalled();
  });
});

describe('admin auth social route availability', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    passport._strategy.mockReturnValue(undefined);

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminAuthRouter);
  });

  const startRoutes = [
    ['saml', 'SAML'],
    ['google', 'Google'],
    ['github', 'GitHub'],
    ['discord', 'Discord'],
    ['facebook', 'Facebook'],
    ['apple', 'Apple'],
  ];

  it.each(startRoutes)(
    'does not start %s admin login when the strategy is not registered',
    async (path, provider) => {
      const response = await request(app).get(`/api/admin/oauth/${path}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: `${provider} configuration not found`,
        error_code: `${provider.toUpperCase()}_NOT_CONFIGURED`,
      });
      expect(storeAndStripChallenge).not.toHaveBeenCalled();
      expect(passport.authenticate).not.toHaveBeenCalled();
    },
  );

  const callbackRoutes = [
    [
      'saml',
      'SAML',
      (agent) => agent.post('/api/admin/oauth/saml/callback').send({ RelayState: 'state' }),
    ],
    ['google', 'Google', (agent) => agent.get('/api/admin/oauth/google/callback?state=state')],
    ['github', 'GitHub', (agent) => agent.get('/api/admin/oauth/github/callback?state=state')],
    ['discord', 'Discord', (agent) => agent.get('/api/admin/oauth/discord/callback?state=state')],
    [
      'facebook',
      'Facebook',
      (agent) => agent.get('/api/admin/oauth/facebook/callback?state=state'),
    ],
    [
      'apple',
      'Apple',
      (agent) => agent.post('/api/admin/oauth/apple/callback').send({ state: 'state' }),
    ],
  ];

  it.each(callbackRoutes)(
    'does not run %s admin callback auth when the strategy is not registered',
    async (path, provider, makeRequest) => {
      const response = await makeRequest(request(app));

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: `${provider} configuration not found`,
        error_code: `${provider.toUpperCase()}_NOT_CONFIGURED`,
      });
    },
  );

  it('starts admin login when the strategy is registered', async () => {
    passport._strategy.mockReturnValue({ name: 'googleAdmin' });
    storeAndStripChallenge.mockResolvedValue(true);

    await request(app).get('/api/admin/oauth/google');

    expect(storeAndStripChallenge).toHaveBeenCalledTimes(1);
    expect(passport.authenticate).toHaveBeenCalledWith(
      'googleAdmin',
      expect.objectContaining({ session: false }),
    );
  });
});

describe('admin local login route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/admin', adminAuthRouter);
  });

  it('applies the email login gate before local auth', async () => {
    const response = await request(app).post('/api/admin/login/local').send({
      email: 'admin@example.com',
      password: 'password',
    });

    expect(response.status).toBe(200);
    expect(middleware.validateEmailLogin).toHaveBeenCalledTimes(1);
    expect(middleware.requireLocalAuth).toHaveBeenCalledTimes(1);
    expect(middleware.validateEmailLogin.mock.invocationCallOrder[0]).toBeLessThan(
      middleware.requireLocalAuth.mock.invocationCallOrder[0],
    );
  });

  it('stops before local auth when the email login gate rejects the request', async () => {
    middleware.validateEmailLogin.mockImplementationOnce((req, res) =>
      res.status(403).json({ message: 'Email login is not allowed.' }),
    );

    const response = await request(app).post('/api/admin/login/local').send({
      email: 'admin@example.com',
      password: 'password',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Email login is not allowed.' });
    expect(middleware.requireLocalAuth).not.toHaveBeenCalled();
  });
});
