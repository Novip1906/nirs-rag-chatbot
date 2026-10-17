const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const mockGetKeys = jest.fn();

jest.mock('jwks-rsa', () => jest.fn(() => ({ getKeys: mockGetKeys })));
jest.mock('@librechat/api', () => ({
  getHttpsProxyAgent: jest.fn(),
  normalizeOpenIdIssuer: (value) => value?.trim().replace(/\/+$/, '') || undefined,
}));

const {
  createOidcTokenVerifier,
  getProcessVerifier,
  audienceIncludes,
  OidcTokenError,
} = require('./oidcTokenVerifier');

const ISSUER = 'http://sso.local/realms/corporate';
const JWKS_URI = `${ISSUER}/protocol/openid-connect/certs`;

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherRsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const publicJwk = (pair, kid, extra = {}) => ({
  ...pair.publicKey.export({ format: 'jwk' }),
  kid,
  ...extra,
});
const privatePem = (pair) => pair.privateKey.export({ type: 'pkcs8', format: 'pem' });

function sign(claims, options = {}, pair = rsa) {
  return jwt.sign({ typ: 'Bearer', ...claims }, privatePem(pair), {
    algorithm: 'RS256',
    keyid: 'kid-1',
    issuer: ISSUER,
    expiresIn: 300,
    ...options,
  });
}

async function reasonOf(promise) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OidcTokenError);
    return error.reason;
  }
  return undefined;
}

describe('oidcTokenVerifier', () => {
  let verify;
  let clock;

  beforeEach(() => {
    clock = 1000000;
    mockGetKeys.mockReset();
    mockGetKeys.mockResolvedValue([
      publicJwk(rsa, 'kid-1'),
      publicJwk(ec, 'kid-ec'),
      publicJwk(otherRsa, 'kid-enc', { use: 'enc' }),
    ]);
    verify = createOidcTokenVerifier({
      issuer: ISSUER,
      jwksUri: JWKS_URI,
      now: () => clock,
    });
  });

  it('returns claims for a valid token', async () => {
    const claims = await verify(sign({ azp: 'admin-api', sub: 's1' }));
    expect(claims).toMatchObject({ azp: 'admin-api', sub: 's1', iss: ISSUER });
  });

  it('known kid is verified from cache while a refetch is hanging', async () => {
    jest.useFakeTimers({ doNotFake: ['Date'] });
    try {
      await verify(sign({ sub: 's1' }));
      clock += 31 * 1000;
      mockGetKeys.mockReturnValue(new Promise(() => {}));
      const unknown = reasonOf(verify(sign({ sub: 's2' }, { keyid: 'kid-unknown' })));
      await Promise.resolve();

      const claims = await verify(sign({ sub: 's3' }));

      expect(claims.sub).toBe('s3');
      jest.advanceTimersByTime(5000);
      expect(await unknown).toBe('unavailable');
    } finally {
      jest.useRealTimers();
    }
  });

  it('accepts ES256 tokens', async () => {
    const token = jwt.sign({ azp: 'x', typ: 'Bearer' }, privatePem(ec), {
      algorithm: 'ES256',
      keyid: 'kid-ec',
      issuer: ISSUER,
      expiresIn: 300,
    });
    expect(await verify(token)).toMatchObject({ azp: 'x' });
  });

  it('rejects an expired token as expired', async () => {
    const token = sign({ azp: 'x' }, { expiresIn: -10 });
    expect(await reasonOf(verify(token))).toBe('expired');
  });

  it('rejects a foreign issuer', async () => {
    const token = sign({ azp: 'x' }, { issuer: 'http://evil.local/realms/corporate' });
    expect(await reasonOf(verify(token))).toBe('invalid');
  });

  it('rejects a bad signature', async () => {
    const token = sign({ azp: 'x' }, {}, otherRsa);
    expect(await reasonOf(verify(token))).toBe('invalid');
  });

  it('rejects HS256 tokens', async () => {
    const token = jwt.sign({ azp: 'x' }, 'secret-secret-secret-secret', {
      algorithm: 'HS256',
      keyid: 'kid-1',
      issuer: ISSUER,
      expiresIn: 300,
    });
    expect(await reasonOf(verify(token))).toBe('invalid');
    expect(mockGetKeys).not.toHaveBeenCalled();
  });

  it('rejects alg none tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'kid-1' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: ISSUER, azp: 'x' })).toString('base64url');
    expect(await reasonOf(verify(`${header}.${body}.`))).toBe('invalid');
  });

  it('rejects garbage and empty input', async () => {
    expect(await reasonOf(verify('not-a-jwt'))).toBe('invalid');
    expect(await reasonOf(verify(''))).toBe('invalid');
    expect(await reasonOf(verify(undefined))).toBe('invalid');
  });

  it('rejects an unknown key id', async () => {
    const token = sign({ azp: 'x' }, { keyid: 'kid-unknown' });
    expect(await reasonOf(verify(token))).toBe('invalid');
  });

  it('reports unavailable when the key set cannot be fetched', async () => {
    mockGetKeys.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await reasonOf(verify(sign({ azp: 'x' })))).toBe('unavailable');
  });

  it('rejects id tokens and refresh tokens', async () => {
    expect(await reasonOf(verify(sign({ azp: 'x', typ: 'ID' })))).toBe('invalid');
    expect(await reasonOf(verify(sign({ azp: 'x', typ: 'Refresh' })))).toBe('invalid');
  });

  it('does not use encryption keys for verification', async () => {
    const token = sign({ azp: 'x' }, { keyid: 'kid-enc' });
    expect(await reasonOf(verify(token))).toBe('invalid');
  });

  it('caches the whole key set for ten minutes', async () => {
    await verify(sign({ azp: 'x' }));
    clock += 9 * 60 * 1000;
    await verify(sign({ azp: 'x' }));
    expect(mockGetKeys).toHaveBeenCalledTimes(1);
    clock += 2 * 60 * 1000;
    await verify(sign({ azp: 'x' }));
    expect(mockGetKeys).toHaveBeenCalledTimes(2);
  });

  it('unknown kid does not refetch more than once per interval', async () => {
    await verify(sign({ azp: 'x' }));
    expect(mockGetKeys).toHaveBeenCalledTimes(1);
    clock += 31 * 1000;
    for (let i = 0; i < 20; i++) {
      expect(await reasonOf(verify(sign({ azp: 'x' }, { keyid: `random-${i}` })))).toBe('invalid');
    }
    expect(mockGetKeys).toHaveBeenCalledTimes(2);
    clock += 10 * 1000;
    expect(await reasonOf(verify(sign({ azp: 'x' }, { keyid: 'random-late' })))).toBe('invalid');
    expect(mockGetKeys).toHaveBeenCalledTimes(2);
  });

  it('rotated key is picked up after interval', async () => {
    await verify(sign({ azp: 'x' }));
    mockGetKeys.mockResolvedValue([publicJwk(rsa, 'kid-1'), publicJwk(otherRsa, 'kid-2')]);
    const rotated = sign({ azp: 'x' }, { keyid: 'kid-2' }, otherRsa);
    clock += 5 * 1000;
    expect(await reasonOf(verify(rotated))).toBe('invalid');
    clock += 26 * 1000;
    expect(await verify(rotated)).toMatchObject({ azp: 'x' });
    expect(mockGetKeys).toHaveBeenCalledTimes(2);
  });

  it('concurrent verifications share one fetch', async () => {
    let release;
    mockGetKeys.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([publicJwk(rsa, 'kid-1')]);
        }),
    );
    const pending = Promise.all([
      verify(sign({ azp: 'a' })),
      verify(sign({ azp: 'b' })),
      verify(sign({ azp: 'c' })),
    ]);
    release();
    const results = await pending;
    expect(results.map((claims) => claims.azp)).toEqual(['a', 'b', 'c']);
    expect(mockGetKeys).toHaveBeenCalledTimes(1);
  });

  it('does not refetch within the interval after a failed fetch', async () => {
    mockGetKeys.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await reasonOf(verify(sign({ azp: 'x' })))).toBe('unavailable');
    expect(await reasonOf(verify(sign({ azp: 'x' })))).toBe('unavailable');
    expect(mockGetKeys).toHaveBeenCalledTimes(1);
  });
});

describe('getProcessVerifier', () => {
  const original = process.env.OPENID_ISSUER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENID_ISSUER;
    } else {
      process.env.OPENID_ISSUER = original;
    }
  });

  it('returns null when the issuer is empty', () => {
    process.env.OPENID_ISSUER = '  ';
    expect(getProcessVerifier()).toBeNull();
    delete process.env.OPENID_ISSUER;
    expect(getProcessVerifier()).toBeNull();
  });

  it('returns one shared verifier and tolerates a trailing slash on the issuer', async () => {
    mockGetKeys.mockReset();
    mockGetKeys.mockResolvedValue([publicJwk(rsa, 'kid-1')]);
    process.env.OPENID_ISSUER = `${ISSUER}/`;
    const first = getProcessVerifier();
    expect(getProcessVerifier()).toBe(first);
    expect(await first(sign({ azp: 'x' }))).toMatchObject({ iss: ISSUER });
  });
});

describe('audienceIncludes', () => {
  it('accepts a string or an array', () => {
    expect(audienceIncludes('a', 'a')).toBe(true);
    expect(audienceIncludes(['b', 'a'], 'a')).toBe(true);
    expect(audienceIncludes(['b'], 'a')).toBe(false);
    expect(audienceIncludes(undefined, 'a')).toBe(false);
  });
});
