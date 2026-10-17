import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuthContext } from '../AuthContext';
import { RequireAuth } from '../RequireAuth';
import { getSession, notifyUnauthorized, setSession } from '../tokenStore';
import {
  consumeSilentTarget,
  markLoggedOutIntentionally,
  markSessionActive,
  storeSilentTarget,
  wasLoggedOutIntentionally,
  wasSessionActive,
} from '../silentSession';

let mockPathname = '/admin/spend';
let mockSearch = '';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname, search: mockSearch }),
  Navigate: () => null,
}));

const mockNavigateExternal = jest.fn();
jest.mock('~/config', () => ({
  navigateExternal: (url: string) => mockNavigateExternal(url),
}));

const mockExchangeCode = jest.fn();
jest.mock('../oidc', () => ({
  buildAuthorizeUrl: ({
    codeChallenge,
    state,
    redirectUri,
  }: {
    codeChallenge: string;
    state: string;
    redirectUri: string;
  }) =>
    `https://sso.example/auth?code_challenge=${codeChallenge}&state=${state}&redirect_uri=${redirectUri}`,
  buildLogoutUrl: (uri: string, hint?: string) =>
    `https://sso.example/logout?post_logout_redirect_uri=${uri}${hint ? `&id_token_hint=${hint}` : ''}`,
  exchangeCode: (...args: unknown[]) => mockExchangeCode(...args),
  readClaims: () => ({ sub: 'user-1', name: 'Ivan', email: 'ivan@example.com' }),
  refreshTokens: jest.fn(),
}));

const user = { id: 'user-1', email: 'ivan@example.com', name: 'Ivan' };
const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 1234 };

function Probe() {
  const { isAuthenticated, isRestoring, user: current } = useAuthContext();
  return (
    <div>
      <span data-testid="restoring">{String(isRestoring)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user">{current?.name ?? ''}</span>
    </div>
  );
}

function Capture({ onReady }: { onReady: (ctx: ReturnType<typeof useAuthContext>) => void }) {
  const ctx = useAuthContext();
  onReady(ctx);
  return null;
}

describe('AuthProvider — silent login on mount', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockExchangeCode.mockReset();
    mockPathname = '/admin/spend';
    mockSearch = '';
  });

  it('resolves immediately with no redirect when the tab never had an active session', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('restoring').textContent).toBe('false'));
    expect(mockNavigateExternal).not.toHaveBeenCalled();
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
  });

  it('shows the restoring state and silently redirects through openid when the flag is set', async () => {
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('restoring').textContent).toBe('true');
    await waitFor(() => expect(mockNavigateExternal).toHaveBeenCalledTimes(1));
    expect(mockNavigateExternal.mock.calls[0][0]).toContain('code_challenge=');
    expect(mockNavigateExternal.mock.calls[0][0]).toContain('state=');
    expect(sessionStorage.getItem('admin.pkce.state')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('stops the indicator and sends the person to /login with an error when the silent redirect fails', async () => {
    markSessionActive();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('restoring').textContent).toBe('false'));
    expect(mockNavigateExternal).toHaveBeenCalledTimes(1);
    expect(mockNavigateExternal.mock.calls[0][0]).toContain('/login?error=');
    expect(wasSessionActive()).toBe(false);
  });

  it('does not leave for the sign-in page when sessionStorage is unavailable', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await expect(ctx!.login()).rejects.toThrow();
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });

  it('preserves the path the user was on so the silent round trip can return them there', async () => {
    mockPathname = '/admin/spend';
    mockSearch = '?range=30d';
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockNavigateExternal).toHaveBeenCalledTimes(1));
    expect(consumeSilentTarget()).toBe('/admin/spend?range=30d');
  });

  it('does not store a target when the silent redirect fires from the login page itself', async () => {
    mockPathname = '/login';
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockNavigateExternal).toHaveBeenCalledTimes(1));
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('does not trigger a silent redirect while sitting on the callback route itself', async () => {
    mockPathname = '/auth/openid/callback';
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('restoring').textContent).toBe('false'));
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });
});

describe('AuthProvider — completeLogin', () => {
  // completeLogin is only ever invoked from AuthCallbackPage, which lives at this
  // path — mounting here means the provider's own silent-redirect effect stays out
  // of the way instead of racing the exchange these tests are exercising directly.
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockExchangeCode.mockReset();
    mockPathname = '/auth/openid/callback';
    mockSearch = '';
  });

  it('marks the session active and stores the token in memory on a successful exchange', async () => {
    mockExchangeCode.mockResolvedValue(tokens);
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const ok = await ctx!.completeLogin('code-1');

    expect(ok).toBe(true);
    expect(wasSessionActive()).toBe(true);
    expect(mockExchangeCode).toHaveBeenCalledWith({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: `${window.location.origin}/auth/openid/callback`,
    });
    expect(getSession()).toMatchObject({
      token: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1234,
      user: { id: 'user-1', name: 'Ivan', email: 'ivan@example.com' },
    });
  });

  it('clears the active flag when the code exchange fails', async () => {
    markSessionActive();
    mockExchangeCode.mockRejectedValue(new Error('invalid code'));
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const ok = await ctx!.completeLogin('code-1');

    expect(ok).toBe(false);
    expect(wasSessionActive()).toBe(false);
  });

  it('clears the intentional-logout flag only once the exchange actually succeeds', async () => {
    markLoggedOutIntentionally();
    mockExchangeCode.mockResolvedValue(tokens);
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const ok = await ctx!.completeLogin('code-1');

    expect(ok).toBe(true);
    expect(wasLoggedOutIntentionally()).toBe(false);
  });

  it('leaves the intentional-logout flag in place when the exchange fails — a failed attempt is not a completed login', async () => {
    markLoggedOutIntentionally();
    mockExchangeCode.mockRejectedValue(new Error('invalid code'));
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const ok = await ctx!.completeLogin('code-1');

    expect(ok).toBe(false);
    expect(wasLoggedOutIntentionally()).toBe(true);
  });

  it('clears the active flag when the verifier is missing (stale or reused callback)', async () => {
    markSessionActive();
    // No verifier stored — simulates a callback replayed after the verifier was consumed.

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    const ok = await ctx!.completeLogin('code-1');

    expect(ok).toBe(false);
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(wasSessionActive()).toBe(false);
  });

  it('a failed exchange this mount does not cause the next mount to retry the silent redirect (no infinite loop)', async () => {
    markSessionActive();
    mockExchangeCode.mockRejectedValue(new Error('invalid code'));
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await ctx!.completeLogin('code-1');
    unmount();

    // The app "reloads" after the failed round trip, landing back on an ordinary route.
    mockPathname = '/admin/spend';
    mockNavigateExternal.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('restoring').textContent).toBe('false'));
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });
});

describe('AuthProvider — 401 unauthorized handling', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockPathname = '/admin/spend';
    mockSearch = '';
  });

  it('clears the in-memory session and the active-session flag on a 401, so a bounce to /login does not retry silently', () => {
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => notifyUnauthorized());

    expect(getSession()).toBeUndefined();
    expect(wasSessionActive()).toBe(false);
    expect(screen.getByTestId('authenticated').textContent).toBe('false');
  });

  it('stores the page the user was on so a repeat login through the bounce to /login returns them there', () => {
    mockPathname = '/admin/users';
    mockSearch = '?page=3';
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => notifyUnauthorized());

    expect(consumeSilentTarget()).toBe('/admin/users?page=3');
  });

  it('does not store a target when the 401 happens while already on the login page', () => {
    mockPathname = '/login';
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => notifyUnauthorized());

    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('does not store a target when the 401 happens on the OpenID callback route', () => {
    mockPathname = '/auth/openid/callback';
    mockSearch = '?code=abc';
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => notifyUnauthorized());

    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('uses the current page at the moment of the 401, not the page from initial mount', () => {
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();
    const queryClient = new QueryClient();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    mockPathname = '/admin/users';
    mockSearch = '?page=3';
    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => notifyUnauthorized());

    expect(consumeSilentTarget()).toBe('/admin/users?page=3');
  });
});

describe('AuthProvider — restore effect bails out on an explicit login error', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockPathname = '/login';
    mockSearch = '';
  });

  it('does not silently redirect when the URL carries an error, even with the active-session flag still set', async () => {
    mockSearch = '?error=auth_failed&error_description=nope';
    markSessionActive();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('restoring').textContent).toBe('false'));
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });
});

describe('AuthProvider — logout', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockPathname = '/admin/spend';
    mockSearch = '';
  });

  it('sends the browser to the single sign-on logout page', () => {
    setSession({ token: 'access-1', user, expiresAt: 0 });
    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => ctx!.logout());

    expect(mockNavigateExternal).toHaveBeenCalledWith(
      `https://sso.example/logout?post_logout_redirect_uri=${window.location.origin}/login`,
    );
  });

  it('passes the stored id token as the logout hint', () => {
    setSession({ token: 'access-1', idToken: 'id-1', user, expiresAt: 0 });
    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => ctx!.logout());

    expect(mockNavigateExternal).toHaveBeenCalledWith(
      `https://sso.example/logout?post_logout_redirect_uri=${window.location.origin}/login&id_token_hint=id-1`,
    );
  });

  it('clears the session, marks the logout intentional, and drops cached query data left by the previous user', () => {
    setSession({ token: 'access-1', user, expiresAt: 0 });
    markSessionActive();
    const client = new QueryClient();
    client.setQueryData(['admin', 'users'], [{ id: 'stale-user' }]);

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => ctx!.logout());

    expect(getSession()).toBeUndefined();
    expect(wasSessionActive()).toBe(false);
    expect(wasLoggedOutIntentionally()).toBe(true);
    expect(client.getQueryData(['admin', 'users'])).toBeUndefined();
  });

  /**
   * Regression: без этого осознанный выход оставлял бы в sessionStorage цель,
   * сохранённую ещё прошлым 401 — следующий вход (в том числе под другой учётной
   * записью) молча унёс бы человека на эту чужую страницу вместо /admin.
   */
  it('clears any silent-restore target left over from an earlier 401, so the next login does not inherit it', () => {
    setSession({ token: 'access-1', user, expiresAt: 0 });
    markSessionActive();
    storeSilentTarget('/admin/users?page=3');

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => ctx!.logout());

    expect(consumeSilentTarget()).toBeUndefined();
  });
});

describe('AuthProvider — logout and the return target', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockPathname = '/admin/ai/users';
    mockSearch = '';
  });

  it('explicit logout drops the return target for the next login', () => {
    setSession({ token: 'access-1', user, expiresAt: 0 });
    markSessionActive();

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Capture onReady={(value) => (ctx = value)} />
          <RequireAuth>
            <div>secret</div>
          </RequireAuth>
        </AuthProvider>
      </QueryClientProvider>,
    );

    act(() => ctx!.logout());
    act(() => notifyUnauthorized());

    expect(consumeSilentTarget()).toBeUndefined();
  });
});
