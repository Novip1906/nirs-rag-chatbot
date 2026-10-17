import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { rawClient } from '~/data-provider/http';
import { registerUnauthorizedHandler, setSession } from '~/auth/tokenStore';
import { useAccess } from '../useAccess';

const mockRefreshTokens = jest.fn();
jest.mock('~/auth/oidc', () => ({
  ...jest.requireActual('~/auth/oidc'),
  refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
}));

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

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAccess over the real http client', () => {
  beforeEach(() => {
    rawClient.defaults.adapter = adapter;
    registerUnauthorizedHandler(unauthorized);
    setSession({
      token: 'old',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 10 * 60_000,
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    });
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'refresh-2',
      expiresAt: Date.now() + 10 * 60_000,
    });
  });

  it('401 from ai after a successful refresh means no ai rights, not a dropped session', async () => {
    adapter.mockImplementation((config: InternalAxiosRequestConfig) =>
      String(config.url).includes('/admin/v1/me')
        ? respond(config, 200, { employee: null, is_admin: true })
        : respond(config, 401),
    );

    const { result } = renderHook(() => useAccess(), { wrapper });

    await waitFor(() => expect(result.current.isAiLoading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.aiError).toBe(false);
    expect(result.current.aiCapabilities.size).toBe(0);
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
