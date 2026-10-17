import {
  getAccessToken,
  refreshSession,
  getSession,
  notifyUnauthorized,
  registerUnauthorizedHandler,
  setSession,
  subscribe,
} from '../tokenStore';
import type { Session } from '../tokenStore';

const mockRefreshTokens = jest.fn();
jest.mock('../oidc', () => ({
  ...jest.requireActual('../oidc'),
  refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
}));

const user = { id: 'user-1', email: 'ivan@example.com', name: 'Ivan' };

describe('tokenStore', () => {
  beforeEach(() => {
    setSession(undefined);
  });

  it('holds the access token only in memory', () => {
    const session: Session = { token: 'access-1', expiresAt: 0, user };
    setSession(session);

    expect(getSession()).toEqual(session);
    expect(getAccessToken()).toBe('access-1');
  });

  it('clears the session on logout', () => {
    setSession({ token: 'access-1', expiresAt: 0, user });
    setSession(undefined);

    expect(getSession()).toBeUndefined();
    expect(getAccessToken()).toBeUndefined();
  });

  it('notifies subscribers whenever the session changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);

    const session: Session = { token: 'access-1', expiresAt: 0, user };
    setSession(session);
    setSession(undefined);

    expect(listener).toHaveBeenNthCalledWith(1, session);
    expect(listener).toHaveBeenNthCalledWith(2, undefined);

    unsubscribe();
    setSession(session);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('shares one refresh between concurrent callers', async () => {
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: 0, user });
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'refresh-2',
      expiresAt: 999,
    });

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokens).toHaveBeenCalledWith('refresh-1');
    expect(getSession()).toMatchObject({
      token: 'new',
      refreshToken: 'refresh-2',
      expiresAt: 999,
      user,
    });
  });

  it('keeps the old refresh token when the provider does not rotate it', async () => {
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: 0, user });
    mockRefreshTokens.mockResolvedValue({ accessToken: 'new', expiresAt: 999 });

    await refreshSession();

    expect(getSession()?.refreshToken).toBe('refresh-1');
  });

  it('returns rejected without refresh token', async () => {
    setSession({ token: 'old', expiresAt: 0, user });

    await expect(refreshSession()).resolves.toBe('rejected');
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it.each([400, 401])('returns rejected when the provider answers %s', async (status) => {
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: 0, user });
    mockRefreshTokens.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status } }));

    await expect(refreshSession()).resolves.toBe('rejected');
    await expect(refreshSession()).resolves.toBe('rejected');
    expect(mockRefreshTokens).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no response', new Error('Network Error')],
    ['5xx', Object.assign(new Error('bad gateway'), { response: { status: 502 } })],
  ])('returns unavailable on %s and keeps the session', async (_name, error) => {
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: 0, user });
    mockRefreshTokens.mockRejectedValue(error);

    await expect(refreshSession()).resolves.toBe('unavailable');
    expect(getSession()?.token).toBe('old');
  });

  it('three unavailable refreshes with expired token drop the session', async () => {
    const handler = jest.fn();
    registerUnauthorizedHandler(handler);
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000, user });
    mockRefreshTokens.mockRejectedValue(new Error('Network Error'));

    await refreshSession();
    await refreshSession();
    expect(handler).not.toHaveBeenCalled();
    await refreshSession();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('three unavailable refreshes with a still valid token keep the session', async () => {
    const handler = jest.fn();
    registerUnauthorizedHandler(handler);
    setSession({
      token: 'old',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 60_000,
      user,
    });
    mockRefreshTokens.mockRejectedValue(new Error('Network Error'));

    await refreshSession();
    await refreshSession();
    await refreshSession();

    expect(handler).not.toHaveBeenCalled();
  });

  it('a successful refresh resets the unavailable counter', async () => {
    const handler = jest.fn();
    registerUnauthorizedHandler(handler);
    setSession({ token: 'old', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000, user });
    mockRefreshTokens.mockRejectedValueOnce(new Error('Network Error'));
    mockRefreshTokens.mockRejectedValueOnce(new Error('Network Error'));
    mockRefreshTokens.mockResolvedValueOnce({ accessToken: 'a', expiresAt: Date.now() - 1000 });
    mockRefreshTokens.mockRejectedValueOnce(new Error('Network Error'));
    mockRefreshTokens.mockRejectedValueOnce(new Error('Network Error'));

    await refreshSession();
    await refreshSession();
    await refreshSession();
    await refreshSession();
    await refreshSession();

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps the id token in memory and replaces it when the provider returns a new one', async () => {
    setSession({ token: 'old', refreshToken: 'refresh-1', idToken: 'id-1', expiresAt: 0, user });
    mockRefreshTokens.mockResolvedValueOnce({ accessToken: 'a2', expiresAt: 1 });
    await refreshSession();
    expect(getSession()?.idToken).toBe('id-1');

    mockRefreshTokens.mockResolvedValueOnce({ accessToken: 'a3', idToken: 'id-2', expiresAt: 2 });
    await refreshSession();
    expect(getSession()?.idToken).toBe('id-2');
  });

  it('invokes the registered unauthorized handler', () => {
    const handler = jest.fn();
    registerUnauthorizedHandler(handler);

    notifyUnauthorized();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
