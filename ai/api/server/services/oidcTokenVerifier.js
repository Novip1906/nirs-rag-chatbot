const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { getHttpsProxyAgent, normalizeOpenIdIssuer } = require('@librechat/api');

const ALLOWED_ALGORITHMS = ['RS256', 'ES256'];
const KEY_SET_TTL_MS = 10 * 60 * 1000;
const REFETCH_INTERVAL_MS = 30 * 1000;
const KEY_FETCH_TIMEOUT_MS = 5 * 1000;

class OidcTokenError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'OidcTokenError';
    this.reason = reason;
  }
}

function audienceIncludes(aud, expected) {
  if (Array.isArray(aud)) {
    return aud.includes(expected);
  }
  return typeof aud === 'string' && aud === expected;
}

function createOidcTokenVerifier({ issuer, jwksUri, now = Date.now }) {
  const options = { cache: false, rateLimit: false, jwksUri };
  const requestAgent = getHttpsProxyAgent ? getHttpsProxyAgent(jwksUri) : undefined;
  if (requestAgent) {
    options.requestAgent = requestAgent;
  }
  const client = jwksRsa(options);

  let keySet = null;
  let lastAttemptAt = null;
  let inflight = null;

  function toKeyMap(jwks) {
    const keys = new Map();
    for (const jwk of jwks || []) {
      if (!jwk || !jwk.kid || jwk.use === 'enc') {
        continue;
      }
      try {
        keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        continue;
      }
    }
    return keys;
  }

  function loadKeySet() {
    if (!inflight) {
      lastAttemptAt = now();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), KEY_FETCH_TIMEOUT_MS);
      });
      inflight = Promise.race([client.getKeys(), timeout])
        .then((jwks) => {
          keySet = { keys: toKeyMap(jwks), fetchedAt: now() };
          return keySet;
        })
        .catch(() => {
          throw new OidcTokenError('unavailable', 'signing keys are unavailable');
        })
        .finally(() => {
          clearTimeout(timer);
          inflight = null;
        });
    }
    return inflight;
  }

  async function resolveKey(kid) {
    const stale = !keySet || now() - keySet.fetchedAt >= KEY_SET_TTL_MS;
    if (!stale) {
      const cached = keySet.keys.get(kid);
      if (cached) {
        return cached;
      }
    }
    if (inflight) {
      const loaded = await inflight;
      const shared = loaded.keys.get(kid);
      if (shared) {
        return shared;
      }
      throw new OidcTokenError('invalid', 'unknown signing key');
    }
    if (lastAttemptAt !== null && now() - lastAttemptAt < REFETCH_INTERVAL_MS) {
      if (stale) {
        throw new OidcTokenError('unavailable', 'signing keys are unavailable');
      }
      throw new OidcTokenError('invalid', 'unknown signing key');
    }
    const loaded = await loadKeySet();
    const key = loaded.keys.get(kid);
    if (!key) {
      throw new OidcTokenError('invalid', 'unknown signing key');
    }
    return key;
  }

  return async function verify(token) {
    if (typeof token !== 'string' || token === '') {
      throw new OidcTokenError('invalid', 'token is missing');
    }
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) {
      throw new OidcTokenError('invalid', 'token is malformed');
    }
    const { alg, kid } = decoded.header;
    if (!ALLOWED_ALGORITHMS.includes(alg) || !kid) {
      throw new OidcTokenError('invalid', 'token algorithm is not allowed');
    }
    const key = await resolveKey(kid);
    let claims;
    try {
      claims = jwt.verify(token, key, { algorithms: ALLOWED_ALGORITHMS, issuer });
    } catch (error) {
      if (error && error.name === 'TokenExpiredError') {
        throw new OidcTokenError('expired', 'token has expired');
      }
      throw new OidcTokenError('invalid', 'token is not valid');
    }
    if (!claims || claims.typ !== 'Bearer') {
      throw new OidcTokenError('invalid', 'token type is not allowed');
    }
    return claims;
  };
}

let processVerifier = null;

function getProcessVerifier() {
  const issuer = normalizeOpenIdIssuer(process.env.OPENID_ISSUER);
  if (!issuer) {
    return null;
  }
  if (!processVerifier || processVerifier.issuer !== issuer) {
    processVerifier = {
      issuer,
      verify: createOidcTokenVerifier({
        issuer,
        jwksUri: `${issuer}/protocol/openid-connect/certs`,
      }),
    };
  }
  return processVerifier.verify;
}

module.exports = {
  createOidcTokenVerifier,
  getProcessVerifier,
  audienceIncludes,
  OidcTokenError,
};
