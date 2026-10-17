import { fireEvent, render, screen } from '@testing-library/react';
import RequireAdmin from '../RequireAdmin';
import { adminAccess, headAccess } from '../__fixtures__/access';

const mockUseAccess = jest.fn();

jest.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet" />,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

jest.mock('~/hooks/useAccess', () => ({
  useAccess: () => mockUseAccess(),
}));

const mockLogout = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ logout: mockLogout }),
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <div data-testid="spinner" />,
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('RequireAdmin', () => {
  it('renders the routes for an admin', () => {
    mockUseAccess.mockReturnValue(adminAccess());

    render(<RequireAdmin />);

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects a head to ai users without rendering the routes', () => {
    mockUseAccess.mockReturnValue(headAccess());

    render(<RequireAdmin />);

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/admin/ai/users');
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows the unavailable message with retry instead of leaving when the service is down', () => {
    const refetchDirectory = jest.fn();
    mockUseAccess.mockReturnValue(headAccess({ directoryError: true, refetchDirectory }));

    render(<RequireAdmin />);

    expect(screen.getByText('com_admin_directory_unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('com_admin_retry'));
    expect(refetchDirectory).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and neither renders nor redirects while access is loading', () => {
    mockUseAccess.mockReturnValue(headAccess({ isLoading: true }));

    render(<RequireAdmin />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('offers logout while access is loading', () => {
    mockLogout.mockReset();
    mockUseAccess.mockReturnValue(headAccess({ isLoading: true }));

    render(<RequireAdmin />);
    fireEvent.click(screen.getByText('com_admin_logout'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('offers logout on the unavailable screen', () => {
    mockLogout.mockReset();
    mockUseAccess.mockReturnValue(headAccess({ directoryError: true }));

    render(<RequireAdmin />);
    fireEvent.click(screen.getByText('com_admin_logout'));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
