const express = require('express');
const passport = require('passport');
const crypto = require('node:crypto');
const { CacheKeys } = require('librechat-data-provider');
const { logger, SystemCapabilities } = require('@librechat/data-schemas');
const {
  getAdminPanelUrl,
  createSetBalanceConfig,
  storeAndStripChallenge,
  tenantContextMiddleware,
} = require('@librechat/api');
const { loginController } = require('~/server/controllers/auth/LoginController');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { createOAuthHandler } = require('~/server/controllers/auth/oauth');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const getLogStores = require('~/cache/getLogStores');
const middleware = require('~/server/middleware');

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();

/** Returns middleware that responds 404 when the given admin passport strategy is not registered. */
function requireAdminStrategy(strategyName, provider) {
  return (req, res, next) => {
    if (passport._strategy(strategyName)) {
      return next();
    }
    return res.status(404).json({
      error: `${provider} configuration not found`,
      error_code: `${provider.toUpperCase()}_NOT_CONFIGURED`,
    });
  };
}

router.post(
  '/login/local',
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  middleware.validateEmailLogin,
  middleware.requireLocalAuth,
  tenantContextMiddleware,
  requireAdminAccess,
  setBalanceConfig,
  loginController,
);

router.get('/verify', middleware.requireJwtAuth, requireAdminAccess, (req, res) => {
  const { password: _p, totpSecret: _t, __v, ...user } = req.user;
  user.id = user._id.toString();
  res.status(200).json({ user });
});

/**
 * Generates a random hex state string for OAuth flows.
 * @returns {string} A 32-byte random hex string.
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to retrieve PKCE challenge from cache using the OAuth state.
 * Reads state from req.oauthState (set by a preceding middleware).
 * @param {string} provider - Provider name for logging.
 * @returns {Function} Express middleware.
 */
function retrievePkceChallenge(provider) {
  return async (req, res, next) => {
    if (!req.oauthState) {
      return next();
    }
    try {
      const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
      const challenge = await cache.get(`pkce:${req.oauthState}`);
      if (challenge) {
        req.pkceChallenge = challenge;
        await cache.delete(`pkce:${req.oauthState}`);
      } else {
        logger.warn(
          `[admin/oauth/${provider}/callback] State present but no PKCE challenge found; PKCE will not be enforced for this request`,
        );
      }
    } catch (err) {
      logger.error(
        `[admin/oauth/${provider}/callback] Failed to retrieve PKCE challenge, aborting:`,
        err,
      );
      return res.redirect(
        `${getAdminPanelUrl()}/auth/${provider}/callback?error=pkce_retrieval_failed&error_description=Failed+to+retrieve+PKCE+challenge`,
      );
    }
    next();
  };
}

/* ──────────────────────────────────────────────
 * SAML Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/saml', requireAdminStrategy('samlAdmin', 'SAML'), async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'saml');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/saml/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('samlAdmin', {
    session: false,
    additionalParams: { RelayState: state },
  })(req, res, next);
});

router.post(
  '/oauth/saml/callback',
  (req, res, next) => {
    req.oauthState = typeof req.body.RelayState === 'string' ? req.body.RelayState : undefined;
    next();
  },
  requireAdminStrategy('samlAdmin', 'SAML'),
  passport.authenticate('samlAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/saml/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('saml'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/saml/callback`),
);

/* ──────────────────────────────────────────────
 * Google Admin Routes
 * ────────────────────────────────────────────── */

router.get(
  '/oauth/google',
  requireAdminStrategy('googleAdmin', 'Google'),
  async (req, res, next) => {
    const state = generateState();
    const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
    const stored = await storeAndStripChallenge(cache, req, state, 'google');
    if (!stored) {
      return res.redirect(
        `${getAdminPanelUrl()}/auth/google/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
      );
    }

    return passport.authenticate('googleAdmin', {
      scope: ['openid', 'profile', 'email'],
      session: false,
      state,
      accessType: 'offline',
      prompt: 'consent',
    })(req, res, next);
  },
);

router.get(
  '/oauth/google/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  requireAdminStrategy('googleAdmin', 'Google'),
  passport.authenticate('googleAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/google/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('google'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/google/callback`),
);

/* ──────────────────────────────────────────────
 * GitHub Admin Routes
 * ────────────────────────────────────────────── */

router.get(
  '/oauth/github',
  requireAdminStrategy('githubAdmin', 'GitHub'),
  async (req, res, next) => {
    const state = generateState();
    const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
    const stored = await storeAndStripChallenge(cache, req, state, 'github');
    if (!stored) {
      return res.redirect(
        `${getAdminPanelUrl()}/auth/github/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
      );
    }

    return passport.authenticate('githubAdmin', {
      scope: ['user:email', 'read:user'],
      session: false,
      state,
    })(req, res, next);
  },
);

router.get(
  '/oauth/github/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  requireAdminStrategy('githubAdmin', 'GitHub'),
  passport.authenticate('githubAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/github/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('github'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/github/callback`),
);

/* ──────────────────────────────────────────────
 * Discord Admin Routes
 * ────────────────────────────────────────────── */

router.get(
  '/oauth/discord',
  requireAdminStrategy('discordAdmin', 'Discord'),
  async (req, res, next) => {
    const state = generateState();
    const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
    const stored = await storeAndStripChallenge(cache, req, state, 'discord');
    if (!stored) {
      return res.redirect(
        `${getAdminPanelUrl()}/auth/discord/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
      );
    }

    return passport.authenticate('discordAdmin', {
      scope: ['identify', 'email'],
      session: false,
      state,
    })(req, res, next);
  },
);

router.get(
  '/oauth/discord/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  requireAdminStrategy('discordAdmin', 'Discord'),
  passport.authenticate('discordAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/discord/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('discord'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/discord/callback`),
);

/* ──────────────────────────────────────────────
 * Facebook Admin Routes
 * ────────────────────────────────────────────── */

router.get(
  '/oauth/facebook',
  requireAdminStrategy('facebookAdmin', 'Facebook'),
  async (req, res, next) => {
    const state = generateState();
    const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
    const stored = await storeAndStripChallenge(cache, req, state, 'facebook');
    if (!stored) {
      return res.redirect(
        `${getAdminPanelUrl()}/auth/facebook/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
      );
    }

    return passport.authenticate('facebookAdmin', {
      scope: ['public_profile'],
      session: false,
      state,
    })(req, res, next);
  },
);

router.get(
  '/oauth/facebook/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  requireAdminStrategy('facebookAdmin', 'Facebook'),
  passport.authenticate('facebookAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/facebook/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('facebook'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/facebook/callback`),
);

/* ──────────────────────────────────────────────
 * Apple Admin Routes (POST callback)
 * ────────────────────────────────────────────── */

router.get('/oauth/apple', requireAdminStrategy('appleAdmin', 'Apple'), async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'apple');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/apple/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('appleAdmin', {
    session: false,
    state,
  })(req, res, next);
});

router.post(
  '/oauth/apple/callback',
  (req, res, next) => {
    req.oauthState = typeof req.body.state === 'string' ? req.body.state : undefined;
    next();
  },
  requireAdminStrategy('appleAdmin', 'Apple'),
  passport.authenticate('appleAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/apple/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('apple'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/apple/callback`),
);

module.exports = router;
