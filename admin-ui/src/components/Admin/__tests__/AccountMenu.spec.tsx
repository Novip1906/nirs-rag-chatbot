import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountMenu, { initialsOf } from '../AccountMenu';

const mockUseAuthContext = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => mockUseAuthContext(),
}));

jest.mock('~/config', () => ({
  chatUrl: () => 'https://chat.example.test',
}));

beforeEach(() => {
  mockUseAuthContext.mockReturnValue({
    user: { id: '1', name: 'Ivan Ivanov', email: 'ivan@example.com' },
    logout: jest.fn(),
  });
});

describe('initialsOf', () => {
  it('takes a letter from each of the first two words of the name', () => {
    expect(initialsOf('Ivan Ivanov', 'ivan@example.com')).toBe('II');
  });

  /** Имя не обязательно заполнено — тогда единственное, что есть, это адрес почты. */
  it('falls back to the email when there is no name', () => {
    expect(initialsOf('', 'ivan.ivanov@example.com')).toBe('II');
    expect(initialsOf(null, null)).toBe('?');
  });
});

describe('AccountMenu', () => {
  it('shows the name on the trigger and the email inside the menu', async () => {
    render(<AccountMenu />);

    const trigger = screen.getByRole('button', { name: 'com_admin_account' });
    expect(trigger).toHaveTextContent('Ivan Ivanov');

    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText('ivan@example.com')).toBeInTheDocument());
  });

  it('logs the admin out from the menu', async () => {
    const mockLogout = jest.fn();
    mockUseAuthContext.mockReturnValue({
      user: { id: '1', name: 'Ivan Ivanov', email: 'ivan@example.com' },
      logout: mockLogout,
    });

    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_account' }));

    const logout = await screen.findByRole('menuitem', { name: 'com_admin_logout' });
    fireEvent.click(logout);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('links back to the chat', async () => {
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_account' }));

    const link = await screen.findByRole('menuitem', { name: 'com_admin_open_chat' });
    expect(link).toHaveAttribute('href', 'https://chat.example.test');
  });

  /** Пока сессия не восстановлена, пользователя ещё нет — рисовать «?» вместо имени незачем. */
  it('renders nothing until the session is known', () => {
    mockUseAuthContext.mockReturnValue({ user: undefined, logout: jest.fn() });
    const { container } = render(<AccountMenu />);
    expect(container).toBeEmptyDOMElement();
  });
});
