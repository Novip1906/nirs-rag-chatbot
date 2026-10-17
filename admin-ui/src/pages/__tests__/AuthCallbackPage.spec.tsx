import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AuthCallbackPage from '../AuthCallbackPage';
import { markSessionActive, storeSilentTarget, wasSessionActive } from '~/auth/silentSession';

let mockSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const mockCompleteLogin = jest.fn();
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ completeLogin: mockCompleteLogin }),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('admin.pkce.state', 'state-1');
    sessionStorage.setItem('admin.pkce.verifier', 'verifier-1');
    mockCompleteLogin.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it('shows a spinner while the exchange is pending', () => {
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'state-1' });
    mockCompleteLogin.mockReturnValue(new Promise(() => {}));

    render(<AuthCallbackPage />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('restores the stored silent-login target after a successful exchange', async () => {
    storeSilentTarget('/admin/spend');
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'state-1' });
    mockCompleteLogin.mockResolvedValue(true);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/admin/spend');
  });

  it('falls back to /admin when no silent-login target was stored (manual login)', async () => {
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'state-1' });
    mockCompleteLogin.mockResolvedValue(true);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/admin');
  });

  it('clears the active-session flag and shows the login form when the backend returns an error', async () => {
    markSessionActive();
    mockSearchParams = new URLSearchParams({ error: 'auth_failed', error_description: 'nope' });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/login?error=auth_failed&error_description=nope',
    );
    expect(mockCompleteLogin).not.toHaveBeenCalled();
    expect(wasSessionActive()).toBe(false);
  });

  it('never calls completeLogin, and clears the flag, when there is no code and no error', async () => {
    markSessionActive();
    mockSearchParams = new URLSearchParams();

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(mockCompleteLogin).not.toHaveBeenCalled();
    expect(wasSessionActive()).toBe(false);
  });

  it('rejects mismatched state', async () => {
    markSessionActive();
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'forged' });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toMatch(/^\/login\?error=/);
    expect(mockCompleteLogin).not.toHaveBeenCalled();
    expect(wasSessionActive()).toBe(false);
  });

  it('rejects a callback without state', async () => {
    mockSearchParams = new URLSearchParams({ code: 'abc' });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(mockCompleteLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['an error', { error: 'access_denied' }],
    ['no code', {}],
    ['a forged state', { code: 'abc', state: 'forged' }],
  ])('removes verifier and state from sessionStorage on %s', async (_name, params) => {
    mockSearchParams = new URLSearchParams(params);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(sessionStorage.getItem('admin.pkce.verifier')).toBeNull();
    expect(sessionStorage.getItem('admin.pkce.state')).toBeNull();
  });

  it('removes the state on success and leaves the verifier to completeLogin', async () => {
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'state-1' });
    mockCompleteLogin.mockResolvedValue(true);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    expect(sessionStorage.getItem('admin.pkce.state')).toBeNull();
    expect(sessionStorage.getItem('admin.pkce.verifier')).toBe('verifier-1');
  });

  it('passes the code to completeLogin when state matches', async () => {
    mockSearchParams = new URLSearchParams({ code: 'abc', state: 'state-1' });
    mockCompleteLogin.mockResolvedValue(true);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockCompleteLogin).toHaveBeenCalledWith('abc'));
  });

  it('shows the login form when completeLogin rejects the code', async () => {
    markSessionActive();
    mockSearchParams = new URLSearchParams({ code: 'bad-code', state: 'state-1' });
    mockCompleteLogin.mockResolvedValue(false);

    render(<AuthCallbackPage />);

    await waitFor(() => expect(screen.getByTestId('navigate')).toBeInTheDocument());
    const to = screen.getByTestId('navigate').getAttribute('data-to') ?? '';
    expect(to.startsWith('/login?error=')).toBe(true);
  });

  it('clears the flag on repeated consecutive errors — no state accumulates that could cause a loop', async () => {
    markSessionActive();
    mockSearchParams = new URLSearchParams({ error: 'auth_failed' });
    const first = render(<AuthCallbackPage />);
    await waitFor(() => expect(wasSessionActive()).toBe(false));
    first.unmount();

    markSessionActive();
    const second = render(<AuthCallbackPage />);
    await waitFor(() => expect(wasSessionActive()).toBe(false));
    second.unmount();

    expect(mockCompleteLogin).not.toHaveBeenCalled();
  });
});
