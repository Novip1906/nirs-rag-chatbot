import React from 'react';
import { act, render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuthContext } from '../AuthContext';
import { notifyUnauthorized, setSession } from '../tokenStore';
import { markSessionActive } from '../silentSession';
import AuthCallbackPage from '~/pages/AuthCallbackPage';

let mockPathname = '/admin/users';
let mockSearch = '?page=3';
let mockCallbackSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname, search: mockSearch }),
  useSearchParams: () => [mockCallbackSearchParams],
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const mockNavigateExternal = jest.fn();
jest.mock('~/config', () => ({
  navigateExternal: (url: string) => mockNavigateExternal(url),
}));

const mockExchangeCode = jest.fn();
jest.mock('../oidc', () => ({
  buildAuthorizeUrl: ({ codeChallenge, state }: { codeChallenge: string; state: string }) =>
    `https://sso.example/auth?code_challenge=${codeChallenge}&state=${state}`,
  buildLogoutUrl: (uri: string) => `https://sso.example/logout?post_logout_redirect_uri=${uri}`,
  exchangeCode: (...args: unknown[]) => mockExchangeCode(...args),
  readClaims: () => ({ sub: 'user-1', name: 'Ivan', email: 'ivan@example.com' }),
  refreshTokens: jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

const user = { id: 'user-1', email: 'ivan@example.com', name: 'Ivan' };

function Probe({ onReady }: { onReady: (ctx: ReturnType<typeof useAuthContext>) => void }) {
  const ctx = useAuthContext();
  onReady(ctx);
  return null;
}

/**
 * Покрывает всю цепочку разом, а не по кускам: 401 роняет сессию и запоминает
 * страницу → приложение показывает /login → LoginPage вызывает login() без
 * аргумента (ровно так, как настоящий автопереход) → сервер входа возвращает на
 * callback → AuthCallbackPage возвращает на запомненную страницу. Раздельные
 * тесты AuthContext/AuthCallbackPage такую регрессию не поймают: каждый из них
 * сам кладёт цель в sessionStorage перед проверкой, поэтому мутация вида
 * «login() без аргумента затирает уже сохранённую цель» (см. redirectToOpenId в
 * AuthContext.tsx) прошла бы оба теста незамеченной — только здесь цель
 * действительно проходит через login() как через промежуточное звено.
 */
describe('силовая цепочка: 401 → /login → login() → callback → возврат на цель', () => {
  beforeEach(() => {
    setSession(undefined);
    sessionStorage.clear();
    localStorage.clear();
    mockNavigateExternal.mockReset();
    mockExchangeCode.mockReset();
    mockPathname = '/admin/users';
    mockSearch = '?page=3';
    mockCallbackSearchParams = new URLSearchParams();
  });

  it('возвращает администратора на страницу, с которой увёл 401, даже когда login() вызван без цели', async () => {
    setSession({ token: 'stale-token', user, expiresAt: 0 });
    markSessionActive();

    let ctx: ReturnType<typeof useAuthContext> | undefined;
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe onReady={(value) => (ctx = value)} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // API получает 401, пока админ на /admin/users?page=3.
    act(() => notifyUnauthorized());

    // Автопереход LoginPage: startLogin() зовёт login() без аргумента — ровно
    // как в src/pages/LoginPage.tsx.
    await act(async () => {
      await ctx!.login();
    });
    expect(mockNavigateExternal).toHaveBeenCalledTimes(1);
    unmount();

    // Единый вход вернул на /auth/openid/callback с кодом — это полная перезагрузка
    // страницы, поэтому AuthProvider монтируется заново.
    mockPathname = '/auth/openid/callback';
    mockSearch = '';
    const state = new URL(mockNavigateExternal.mock.calls[0][0]).searchParams.get('state') ?? '';
    mockCallbackSearchParams = new URLSearchParams({ code: 'abc', state });
    mockExchangeCode.mockResolvedValue({ accessToken: 'fresh-token', expiresAt: 0 });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <AuthCallbackPage />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/admin/users?page=3');
  });
});
