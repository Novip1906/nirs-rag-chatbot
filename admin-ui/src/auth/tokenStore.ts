import type { TUser } from '../types/user';
import { readClaims, refreshTokens } from './oidc';
import type { TokenSet } from './oidc';

export interface Session {
  token: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  user: TUser;
}

type Listener = (session: Session | undefined) => void;

let currentSession: Session | undefined;
let unavailableRefreshes = 0;
const listeners = new Set<Listener>();

export function getSession(): Session | undefined {
  return currentSession;
}

export function getAccessToken(): string | undefined {
  return currentSession?.token;
}

export function setSession(session: Session | undefined): void {
  currentSession = session;
  if (session == null) {
    unavailableRefreshes = 0;
  }
  listeners.forEach((listener) => listener(currentSession));
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sessionFromTokens(tokens: TokenSet): Session {
  const claims = readClaims(tokens.accessToken);
  return {
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    expiresAt: tokens.expiresAt,
    user: {
      id: claims.sub,
      name: claims.name ?? claims.email ?? '',
      email: claims.email ?? '',
    },
  };
}

export type RefreshResult = 'ok' | 'rejected' | 'unavailable';

const MAX_UNAVAILABLE_REFRESHES = 3;

let refreshInFlight: Promise<RefreshResult> | undefined;

function isRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 400 || status === 401;
}

async function runRefresh(refreshToken: string): Promise<RefreshResult> {
  try {
    const tokens = await refreshTokens(refreshToken);
    if (currentSession == null) {
      return 'rejected';
    }
    setSession({
      ...currentSession,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? refreshToken,
      idToken: tokens.idToken ?? currentSession.idToken,
      expiresAt: tokens.expiresAt,
    });
    unavailableRefreshes = 0;
    return 'ok';
  } catch (error) {
    if (isRejection(error)) {
      return 'rejected';
    }
    unavailableRefreshes += 1;
    if (
      unavailableRefreshes >= MAX_UNAVAILABLE_REFRESHES &&
      currentSession != null &&
      currentSession.expiresAt <= Date.now()
    ) {
      unavailableRefreshes = 0;
      notifyUnauthorized();
    }
    return 'unavailable';
  }
}

export function refreshSession(): Promise<RefreshResult> {
  const refreshToken = currentSession?.refreshToken;
  if (refreshToken == null) {
    return Promise.resolve('rejected');
  }
  if (refreshInFlight == null) {
    refreshInFlight = runRefresh(refreshToken).finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}

export type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | undefined;

export function registerUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
