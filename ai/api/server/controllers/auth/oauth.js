const { CacheKeys } = require('librechat-data-provider');
const { logger, DEFAULT_REFRESH_TOKEN_EXPIRY } = require('@librechat/data-schemas');
const {
  math,
  isEnabled,
  getAdminPanelUrl,
  isAdminPanelRedirect,
  generateAdminExchangeCode,
  getAdminSessionExpiry,
  shouldUseSecureCookie,
} = require('@librechat/api');
const { syncUserEntraGroupMemberships } = require('~/server/services/PermissionService');
const { setAuthTokens, setOpenIDAuthTokens } = require('~/server/services/AuthService');
const getLogStores = require('~/cache/getLogStores');
const { checkBan } = require('~/server/middleware');
const { generateToken } = require('~/models');

const domains = {
  client: process.env.DOMAIN_CLIENT,
  server: process.env.DOMAIN_SERVER,
};

function createOAuthHandler(redirectUri = domains.client) {
  /**
   * A handler to process OAuth authentication results.
   * @type {Function}
   * @param {ServerRequest} req - Express request object.
   * @param {ServerResponse} res - Express response object.
   * @param {NextFunction} next - Express next middleware function.
   */
  return async (req, res, next) => {
    try {
      if (res.headersSent) {
        return;
      }

      await checkBan(req, res);
      if (req.banned) {
        return;
      }

      /** Check if this is an admin panel redirect (cross-origin or same-origin subpath) */
      if (isAdminPanelRedirect(redirectUri, getAdminPanelUrl(), domains.client)) {
        /** For admin panel, generate exchange code instead of setting cookies */
        const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
        const adminSessionExpiry = getAdminSessionExpiry();
        const token = await generateToken(req.user, adminSessionExpiry);

        let refreshToken;
        if (req.user.provider === 'openid') {
          if (isEnabled(process.env.OPENID_REUSE_TOKENS) === true) {
            refreshToken =
              req.user.tokenset?.refresh_token || req.user.federatedTokens?.refresh_token;
          }
        } else if (req.user.provider === 'google') {
          refreshToken = req.authInfo?.refreshToken;
        }
        const expiresAt = Date.now() + adminSessionExpiry;

        const callbackUrl = new URL(redirectUri);
        const exchangeCode = await generateAdminExchangeCode(
          cache,
          req.user,
          token,
          refreshToken,
          callbackUrl.origin,
          req.pkceChallenge,
          expiresAt,
        );
        callbackUrl.searchParams.set('code', exchangeCode);
        logger.info(`[OAuth] Admin panel redirect with exchange code for user: ${req.user.email}`);
        return res.redirect(callbackUrl.toString());
      }

      /** Standard OAuth flow - set cookies and redirect */
      if (
        req.user &&
        req.user.provider == 'openid' &&
        isEnabled(process.env.OPENID_REUSE_TOKENS) === true
      ) {
        await syncUserEntraGroupMemberships(req.user, req.user.tokenset.access_token);
        setOpenIDAuthTokens(req.user.tokenset, req, res, {
          userId: req.user._id.toString(),
          tenantId: req.user.tenantId,
        });
      } else {
        await setAuthTokens(req.user._id, res, null, req);
        if (req.user.provider === 'openid' && req.user.tokenset?.id_token) {
          const idTokenExpiry = math(
            process.env.REFRESH_TOKEN_EXPIRY,
            DEFAULT_REFRESH_TOKEN_EXPIRY,
          );
          res.cookie('openid_id_token', req.user.tokenset.id_token, {
            expires: new Date(Date.now() + idTokenExpiry),
            httpOnly: true,
            secure: shouldUseSecureCookie(),
            sameSite: 'strict',
          });
        } else if (req.user.provider === 'openid') {
          res.clearCookie('openid_id_token');
        }
      }
      res.redirect(redirectUri);
    } catch (err) {
      logger.error('Error in setting authentication tokens:', err);
      next(err);
    }
  };
}

module.exports = {
  createOAuthHandler,
};
