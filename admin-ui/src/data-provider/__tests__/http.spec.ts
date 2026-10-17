import { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { rawClient, request } from '../http';
import { getAccessToken, registerUnauthorizedHandler, setSession } from '../../auth/tokenStore';

const mockRefreshTokens = jest.fn();
jest.mock('../../auth/oidc', () => ({
  ...jest.requireActual('../../auth/oidc'),
  refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
}));

function rejection(status: number): Error {
  return Object.assign(new Error('token endpoint'), { response: { status } });
}

const user = { id: 'user-1', email: 'ivan@example.com', name: 'Ivan' };
const adapter = jest.fn();
const unauthorized = jest.fn();

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  const response = { data, status, statusText: '', headers: {}, config };
  if (status >= 400) {
    return Promise.reject(
      new AxiosError('failed', AxiosError.ERR_BAD_REQUEST, config, null, response),
    );
  }
  return Promise.resolve(response);
}

describe('http client token handling', () => {
  beforeEach(() => {
    rawClient.defaults.adapter = adapter;
    registerUnauthorizedHandler(unauthorized);
    setSession({
      token: 'old',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 10 * 60_000,
      user,
    });
  });

  it('retries once after refreshing an expired token', async () => {
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 10 * 60_000,
    });
    adapter.mockImplementation((config: InternalAxiosRequestConfig) =>
      respond(config, config.headers.Authorization === 'Bearer new' ? 200 : 401, { ok: true }),
    );

    const data = await request.get('/thing');

    expect(data).toEqual({ ok: true });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer old');
    expect(adapter.mock.calls[1][0].headers.Authorization).toBe('Bearer new');
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('gives up after failed refresh', async () => {
    mockRefreshTokens.mockRejectedValue(rejection(400));
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 401));

    await expect(request.get('/thing')).rejects.toBeDefined();

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('second 401 after successful refresh rejects without dropping session', async () => {
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'new',
      expiresAt: Date.now() + 10 * 60_000,
    });
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 401));

    await expect(request.get('/thing')).rejects.toBeDefined();

    expect(adapter).toHaveBeenCalledTimes(2);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('new');
  });

  it('keeps the session and fails with a network error when the refresh is unavailable', async () => {
    mockRefreshTokens.mockRejectedValue(new Error('Network Error'));
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 401));

    await expect(request.get('/thing')).rejects.toMatchObject({ code: 'ERR_NETWORK' });

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('old');
  });

  it('keeps the session when the token endpoint answers 5xx', async () => {
    mockRefreshTokens.mockRejectedValue(rejection(503));
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 401));

    await expect(request.get('/thing')).rejects.toMatchObject({ code: 'ERR_NETWORK' });

    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('refreshes proactively when token is about to expire', async () => {
    setSession({
      token: 'old',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 10_000,
      user,
    });
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'new',
      expiresAt: Date.now() + 10 * 60_000,
    });
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 200));

    await request.get('/thing');

    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer new');
  });

  it('does not refresh while the token is fresh', async () => {
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => respond(config, 200));

    await request.get('/thing');

    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });
});
