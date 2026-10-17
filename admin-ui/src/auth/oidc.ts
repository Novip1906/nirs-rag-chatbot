import axios from 'axios';
import { oidcClientId, oidcIssuer } from '../config';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
}

export interface TokenClaims {
  sub: string;
  name?: string;
  email?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

const tokenClient = axios.create();

const protocolBase = (): string => `${oidcIssuer()}/protocol/openid-connect`;

export function buildAuthorizeUrl(params: {
  codeChallenge: string;
  state: string;
  redirectUri: string;
}): string {
  const url = new URL(`${protocolBase()}/auth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oidcClientId());
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  return url.toString();
}

async function requestTokens(body: Record<string, string>): Promise<TokenSet> {
  const response = await tokenClient.post<TokenResponse>(
    `${protocolBase()}/token`,
    new URLSearchParams({ ...body, client_id: oidcClientId() }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const { access_token, refresh_token, id_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    idToken: id_token,
    expiresAt: Date.now() + expires_in * 1000,
  };
}

export function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenSet> {
  return requestTokens({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export function buildLogoutUrl(postLogoutRedirectUri: string, idTokenHint?: string): string {
  const url = new URL(`${protocolBase()}/logout`);
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  url.searchParams.set('client_id', oidcClientId());
  if (idTokenHint) {
    url.searchParams.set('id_token_hint', idTokenHint);
  }
  return url.toString();
}

export function readClaims(accessToken: string): TokenClaims {
  const payload = accessToken.split('.')[1] ?? '';
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;
  return {
    sub: String(claims.sub ?? ''),
    name: text(claims.name) ?? text(claims.preferred_username),
    email: text(claims.email),
  };
}
