import React from 'react';
import { render, screen } from '@testing-library/react';
import { RequireAuth } from '../RequireAuth';
import { consumeSilentTarget } from '../silentSession';

let mockPathname = '/admin/users';
let mockSearch = '?page=3';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname, search: mockSearch }),
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

let mockAuthState: { isAuthenticated: boolean; isRestoring: boolean } = {
  isAuthenticated: false,
  isRestoring: false,
};
jest.mock('../AuthContext', () => ({
  useAuthContext: () => mockAuthState,
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

describe('RequireAuth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockPathname = '/admin/users';
    mockSearch = '?page=3';
    mockAuthState = { isAuthenticated: false, isRestoring: false };
  });

  it('shows a spinner while the session is being restored, without touching the target', () => {
    mockAuthState = { isAuthenticated: false, isRestoring: true };

    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(consumeSilentTarget()).toBeUndefined();
  });

  it('renders the protected content once authenticated', () => {
    mockAuthState = { isAuthenticated: true, isRestoring: false };

    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  /**
   * Regression: открытие защищённой страницы в новой вкладке (глубокая ссылка) не
   * проходит через 401-обработчик AuthContext — там некому перехватывать запрос,
   * сессии просто нет с самого начала. Раньше RequireAuth в этом случае просто
   * уводил на /login, ничего не сохранив, и после входа человек оказывался на
   * /admin вместо страницы, которую открывал.
   */
  it('stores the page it bounced from before redirecting to /login', () => {
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/login');
    expect(consumeSilentTarget()).toBe('/admin/users?page=3');
  });

  it('does not store a target when the bounce happens from the login page itself', () => {
    mockPathname = '/login';
    mockSearch = '';

    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(consumeSilentTarget()).toBeUndefined();
  });
});
