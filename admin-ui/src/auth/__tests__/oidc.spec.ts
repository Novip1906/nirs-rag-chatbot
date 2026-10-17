const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ post: (...args: unknown[]) => mockPost(...args) }) },
}));

jest.mock('../../config', () => ({
  oidcIssuer: () => 'https://sso.example/realms/corporate',
  oidcClientId: () => 'admin',
}));

import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  exchangeCode,
  readClaims,
  refreshTokens,
} from '../oidc';

function jwt(payload: object): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

describe('oidc', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  it('builds authorize url with pkce and state', () => {
    const url = new URL(
      buildAuthorizeUrl({
        codeChallenge: 'challenge-1',
        state: 'state-1',
        redirectUri: 'https://admin.example/auth/openid/callback',
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://sso.example/realms/corporate/protocol/openid-connect/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'admin',
      redirect_uri: 'https://admin.example/auth/openid/callback',
      scope: 'openid',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      state: 'state-1',
    });
  });

  it('exchanges code with form body', async () => {
    mockPost.mockResolvedValue({
      data: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 300 },
    });

    const tokens = await exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://admin.example/auth/openid/callback',
    });

    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('https://sso.example/realms/corporate/protocol/openid-connect/token');
    expect(Object.fromEntries(new URLSearchParams(String(body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'admin',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'https://admin.example/auth/openid/callback',
    });
    expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      idToken: undefined,
      expiresAt: 1_000_000 + 300_000,
    });
  });

  it('refreshes tokens', async () => {
    mockPost.mockResolvedValue({ data: { access_token: 'access-2', expires_in: 60 } });

    const tokens = await refreshTokens('refresh-1');

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('https://sso.example/realms/corporate/protocol/openid-connect/token');
    expect(Object.fromEntries(new URLSearchParams(String(body)))).toEqual({
      grant_type: 'refresh_token',
      client_id: 'admin',
      refresh_token: 'refresh-1',
    });
    expect(tokens).toEqual({
      accessToken: 'access-2',
      refreshToken: undefined,
      idToken: undefined,
      expiresAt: 1_000_000 + 60_000,
    });
  });

  it('reads claims from access token', () => {
    const token = jwt({ sub: 'sub-1', name: 'Иван Иванов', email: 'ivan@example.com' });

    expect(readClaims(token)).toEqual({
      sub: 'sub-1',
      name: 'Иван Иванов',
      email: 'ivan@example.com',
    });
  });

  it('returns the id token from the token response', async () => {
    mockPost.mockResolvedValue({
      data: { access_token: 'a', id_token: 'id-1', expires_in: 60 },
    });

    const tokens = await refreshTokens('refresh-1');

    expect(tokens.idToken).toBe('id-1');
  });

  it('passes the id token hint to the logout url', () => {
    const url = new URL(buildLogoutUrl('https://admin.example/login', 'id-1'));

    expect(url.searchParams.get('id_token_hint')).toBe('id-1');
  });

  it('omits the id token hint when there is no id token', () => {
    const url = new URL(buildLogoutUrl('https://admin.example/login'));

    expect(url.searchParams.has('id_token_hint')).toBe(false);
  });

  it('builds logout url', () => {
    const url = new URL(buildLogoutUrl('https://admin.example/login'));

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://sso.example/realms/corporate/protocol/openid-connect/logout',
    );
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://admin.example/login');
    expect(url.searchParams.get('client_id')).toBe('admin');
  });
});
