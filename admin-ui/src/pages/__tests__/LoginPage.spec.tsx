import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginPage from '../LoginPage';

let mockSearchParams = new URLSearchParams();

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const mockLogin = jest.fn().mockResolvedValue(undefined);
let mockAuthState = { isAuthenticated: false, isRestoring: false };
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ ...mockAuthState, login: mockLogin }),
  useLocalize: () => (key: string) => key,
}));

const mockWasLoggedOutIntentionally = jest.fn();
const mockRecentAutoLoginAttempt = jest.fn();
const mockMarkAutoLoginAttempt = jest.fn();
jest.mock('~/auth/silentSession', () => ({
  wasLoggedOutIntentionally: () => mockWasLoggedOutIntentionally(),
  recentAutoLoginAttempt: (withinMs: number) => mockRecentAutoLoginAttempt(withinMs),
  markAutoLoginAttempt: () => mockMarkAutoLoginAttempt(),
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Spinner: () => <div data-testid="spinner" />,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockLogin.mockResolvedValue(undefined);
    mockWasLoggedOutIntentionally.mockReset();
    mockWasLoggedOutIntentionally.mockReturnValue(false);
    mockRecentAutoLoginAttempt.mockReset();
    mockRecentAutoLoginAttempt.mockReturnValue(false);
    mockMarkAutoLoginAttempt.mockReset();
    mockSearchParams = new URLSearchParams();
    mockAuthState = { isAuthenticated: false, isRestoring: false };
  });

  it('при чистом состоянии запускает автопереход на единый вход ровно один раз', async () => {
    render(
      <React.StrictMode>
        <LoginPage />
      </React.StrictMode>,
    );

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    expect(mockMarkAutoLoginAttempt).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('при ошибке предыдущей попытки не запускает автопереход и показывает кнопку входа', async () => {
    mockSearchParams = new URLSearchParams({ error: 'access_denied', error_description: 'Отказано' });

    render(<LoginPage />);

    await screen.findByRole('button');
    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByText('Отказано')).toBeInTheDocument();
  });

  it('когда описание ошибки пустое — показывает осмысленный общий текст, а не пустой абзац', async () => {
    mockSearchParams = new URLSearchParams({ error: 'exchange_failed', error_description: '' });

    render(<LoginPage />);

    const button = await screen.findByRole('button');
    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByText('com_admin_login_error_generic')).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it('после осознанного выхода не запускает автопереход и показывает кнопку входа', async () => {
    mockWasLoggedOutIntentionally.mockReturnValue(true);

    render(<LoginPage />);

    await screen.findByRole('button');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('пока сессия восстанавливается — показывает индикатор, а не пустой экран', () => {
    mockAuthState = { isAuthenticated: false, isRestoring: true };

    render(<LoginPage />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('при быстром повторном заходе после недавнего автоперехода не уходит в новый переход, а показывает объяснение и кнопку', async () => {
    mockRecentAutoLoginAttempt.mockReturnValue(true);

    render(<LoginPage />);

    const button = await screen.findByRole('button');
    expect(mockLogin).not.toHaveBeenCalled();
    expect(screen.getByText('com_admin_login_retry_notice')).toBeInTheDocument();
    expect(button).toBeInTheDocument();
  });

  it('когда переход на единый вход падает (crypto.subtle или sessionStorage недоступны) — показывает объяснение вместо вечного спиннера', async () => {
    mockLogin.mockRejectedValue(new Error('SecurityError'));

    render(<LoginPage />);

    await screen.findByRole('button');
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_login_redirect_failed')).toBeInTheDocument();
  });

  it('повторный клик по кнопке после отказа перехода запускает login ещё раз', async () => {
    mockLogin.mockRejectedValueOnce(new Error('SecurityError'));

    render(<LoginPage />);

    const button = await screen.findByRole('button');
    expect(screen.getByText('com_admin_login_redirect_failed')).toBeInTheDocument();

    mockLogin.mockResolvedValueOnce(undefined);
    fireEvent.click(button);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('com_admin_login_redirect_failed')).not.toBeInTheDocument();
  });
});
