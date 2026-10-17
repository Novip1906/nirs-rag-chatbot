import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { adminAccess, headAccess } from '../__fixtures__/access';
import AdminLayout from '../AdminLayout';

jest.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="admin-outlet" />,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  NavLink: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: (state: { isActive: boolean }) => string;
  }) => (
    <a href={to} className={className?.({ isActive: false })}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: '/admin/users' }),
  useNavigate: () => jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => mockUseAuthContext(),
  useAccess: () => mockUseAccess(),
}));

const mockNavigateExternal = jest.fn();
jest.mock('~/config', () => ({
  chatUrl: () => 'https://chat.example.test',
  navigateExternal: (url: string) => mockNavigateExternal(url),
}));

/**
 * The real `@librechat/client` bundle pulls in `@react-spring/web`, which this checkout
 * can't resolve from here (pre-existing environment gap, not this component's doing).
 * Stubbed so importing `IconButton` doesn't load the whole bundle just to render a button.
 */
jest.mock('@librechat/client', () => ({
  SegmentedControl: jest.requireActual('~/ui/components/SegmentedControl').SegmentedControl,
  IconButton: ({
    children,
    label,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    label: string;
    onClick?: () => void;
    className?: string;
  }) => (
    <button type="button" aria-label={label} onClick={onClick} className={className}>
      {children}
    </button>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Skeleton: ({ className }: { className?: string }) => <div className={className} />,
  Spinner: () => <div data-testid="layout-spinner" />,
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
}));

const mockLogout = jest.fn();
const mockUseAuthContext = jest.fn();
const mockUseAccess = jest.fn();

describe('AdminLayout', () => {
  beforeEach(() => {
    mockUseAuthContext.mockReset();
    mockLogout.mockReset();
    mockUseAccess.mockReset();
    mockUseAccess.mockReturnValue(adminAccess());
    mockNavigateExternal.mockReset();
  });

  it('renders nothing while the auth session is still resolving', () => {
    mockUseAuthContext.mockReturnValue({ isAuthenticated: false, user: undefined });
    const { container } = render(<AdminLayout />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends a non-admin user back to chat instead of showing the admin shell', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
    });
    mockUseAccess.mockReturnValue(adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false }));
    const { container } = render(<AdminLayout />);
    expect(mockNavigateExternal).toHaveBeenCalledWith('https://chat.example.test');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the admin shell for an admin user', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
    });
    mockUseAccess.mockReturnValue(adminAccess());
    render(<AdminLayout />);
    expect(screen.getByTestId('admin-outlet')).toBeInTheDocument();
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });

  /**
   * `HEAD` не входит в `isAdminLevelRole` (сервер не должен раздавать ей все capability
   * при сидинге), но заходит в тот же кабинет тем же входом — какие разделы ей
   * показывать, решает `AdminNav` через `useCapabilities`, не этот гейт.
   */
  it('renders the admin shell for a department head', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
    });
    mockUseAccess.mockReturnValue(headAccess());
    render(<AdminLayout />);
    expect(screen.getByTestId('admin-outlet')).toBeInTheDocument();
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });

  it('does not send anyone to chat while access is still loading', () => {
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true, user: { id: '1' } });
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, isLoading: true }),
    );

    render(<AdminLayout />);

    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });

  it('renders nothing but loader while access is loading', () => {
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true, user: { id: '1' } });
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, isLoading: true }),
    );

    render(<AdminLayout />);

    expect(screen.getByTestId('layout-spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows retry instead of leaving for chat when a non-admin hits an ai backend failure', () => {
    const refetchAi = jest.fn();
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true, user: { id: '1' } });
    mockUseAccess.mockReturnValue(
      adminAccess({
        isAdmin: false,
        aiCapabilities: new Set(),
        canEnter: false,
        aiError: true,
        refetchAi,
      }),
    );

    render(<AdminLayout />);

    expect(mockNavigateExternal).not.toHaveBeenCalled();
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('com_admin_retry'));
    expect(refetchAi).toHaveBeenCalledTimes(1);
  });

  it('lets an admin in when only the ai backend is unavailable', () => {
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true, user: { id: '1' } });
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set(), aiError: true }));

    render(<AdminLayout />);

    expect(screen.getByTestId('admin-outlet')).toBeInTheDocument();
    expect(mockNavigateExternal).not.toHaveBeenCalled();
  });

  it('shows retry when directory is unavailable', () => {
    const refetchDirectory = jest.fn();
    mockUseAuthContext.mockReturnValue({ isAuthenticated: true, user: { id: '1' } });
    mockUseAccess.mockReturnValue(
      adminAccess({
        isAdmin: false,
        aiCapabilities: new Set(),
        canEnter: false,
        directoryError: true,
        refetchDirectory,
      }),
    );

    render(<AdminLayout />);

    expect(screen.getByText('com_admin_directory_unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-outlet')).not.toBeInTheDocument();
    expect(mockNavigateExternal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('com_admin_retry'));
    expect(refetchDirectory).toHaveBeenCalledTimes(1);
  });

  it('sets the tab title to the admin app title', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
    });
    mockUseAccess.mockReturnValue(adminAccess());
    render(<AdminLayout />);
    expect(document.title).toBe('Corporate Admin');
  });

  /**
   * Что именно лежит в меню аккаунта (почта, выход, переход в чат), проверяет
   * `AccountMenu`; здесь важно лишь, что шапка вообще даёт до него добраться —
   * без этой кнопки из админки не выйти.
   */
  it('shows the account menu for a signed-in admin', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1', name: 'Ivan Ivanov', email: 'ivan@example.com' },
      logout: jest.fn(),
    });
    mockUseAccess.mockReturnValue(adminAccess());
    render(<AdminLayout />);

    expect(screen.getByRole('button', { name: 'com_admin_account' })).toBeInTheDocument();
  });

  it('offers the language and theme switchers in the header', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1', name: 'Ivan Ivanov', email: 'ivan@example.com' },
      logout: jest.fn(),
    });
    mockUseAccess.mockReturnValue(adminAccess());
    render(<AdminLayout />);

    expect(
      screen.getByRole('radiogroup', { name: 'com_admin_language_label' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'com_admin_theme_label' })).toBeInTheDocument();
  });

  it('offers logout on the access loading screen', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
      logout: mockLogout,
    });
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, isLoading: true }),
    );

    render(<AdminLayout />);
    fireEvent.click(screen.getByText('com_admin_logout'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('offers logout on the ai failure screen', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
      logout: mockLogout,
    });
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, aiError: true }),
    );

    render(<AdminLayout />);
    fireEvent.click(screen.getByText('com_admin_logout'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('offers logout on the directory failure screen', () => {
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: '1' },
      logout: mockLogout,
    });
    mockUseAccess.mockReturnValue(
      adminAccess({
        isAdmin: false,
        aiCapabilities: new Set(),
        canEnter: false,
        directoryError: true,
      }),
    );

    render(<AdminLayout />);
    fireEvent.click(screen.getByText('com_admin_logout'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
