import { render, screen } from '@testing-library/react';
import AdminNav from '../AdminNav';
import { adminAccess, headAccess } from '../__fixtures__/access';

const mockUseAccess = jest.fn();
let mockPathname = '/admin/users';

jest.mock('react-router-dom', () => ({
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
  useLocation: () => ({ pathname: mockPathname }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAccess: () => mockUseAccess(),
}));

jest.mock('@librechat/client', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="nav-skeleton-item" className={className} />
  ),
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  mockPathname = '/admin/users';
  mockUseAccess.mockReturnValue(adminAccess());
});

describe('AdminNav', () => {
  it('shows a loading skeleton instead of an empty sidebar while access is loading', () => {
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, isLoading: true }),
    );

    render(<AdminNav />);

    expect(screen.getAllByTestId('nav-skeleton-item').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the nav landmark present while loading', () => {
    mockUseAccess.mockReturnValue(adminAccess({ isLoading: true }));

    render(<AdminNav />);

    expect(screen.getByRole('navigation', { name: 'com_admin_nav_label' })).toBeInTheDocument();
  });

  it('renders the general sections for an admin', () => {
    render(<AdminNav />);

    expect(screen.getByText('com_admin_nav_users')).toBeInTheDocument();
    expect(screen.getByText('com_admin_nav_departments')).toBeInTheDocument();
    expect(screen.queryByText('com_admin_nav_requests')).not.toBeInTheDocument();
  });

  it('renders the ai sections for an admin on an ai route', () => {
    mockPathname = '/admin/ai/users';

    render(<AdminNav />);

    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links.slice(0, 2)).toEqual(['/admin/ai/users', '/admin/ai/departments']);
    expect(links).toContain('/admin/requests');
  });

  it('shows a head only the ai sections it has capabilities for', () => {
    mockPathname = '/admin/ai/users';
    mockUseAccess.mockReturnValue(headAccess());

    render(<AdminNav />);

    expect(screen.getByText('com_admin_nav_ai_users')).toBeInTheDocument();
    expect(screen.queryByText('com_admin_nav_ai_departments')).not.toBeInTheDocument();
    expect(screen.queryByText('com_admin_nav_analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('com_admin_nav_feedback')).not.toBeInTheDocument();
  });

  it('renders an empty sidebar for a head who opens a general route directly', () => {
    mockPathname = '/admin/departments';
    mockUseAccess.mockReturnValue(headAccess());

    render(<AdminNav />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a retryable error on the ai tab when the ai backend is down', () => {
    const refetchAi = jest.fn();
    mockPathname = '/admin/ai/users';
    mockUseAccess.mockReturnValue(
      adminAccess({ aiCapabilities: new Set(), aiError: true, refetchAi }),
    );

    render(<AdminNav />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'com_admin_retry' }).click();
    expect(refetchAi).toHaveBeenCalledTimes(1);
  });

  it('keeps general sections usable while the ai backend is down', () => {
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set(), aiError: true }));

    render(<AdminNav />);

    expect(screen.getByText('com_admin_nav_users')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
