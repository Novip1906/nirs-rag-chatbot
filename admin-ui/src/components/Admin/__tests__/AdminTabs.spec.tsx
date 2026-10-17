import { render, screen, fireEvent } from '@testing-library/react';
import AdminTabs from '../AdminTabs';
import { adminAccess, headAccess } from '../__fixtures__/access';

const mockNavigate = jest.fn();
const mockUseAccess = jest.fn();
let mockPathname = '/admin/users';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAccess: () => mockUseAccess(),
}));

jest.mock('@librechat/client', () => ({
  /**
   * Полосу вкладок рисует настоящий `SegmentedControl` — подменять его нечем, иначе
   * проверять было бы нечего: вся разметка вкладок (роли, выбранность, стрелки) живёт
   * в нём. Замокан только остальной бандл, который иначе тянется сюда целиком.
   */
  SegmentedControl: jest.requireActual('~/ui/components/SegmentedControl').SegmentedControl,
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="tabs-skeleton-item" className={className} />
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
  mockNavigate.mockReset();
  mockPathname = '/admin/users';
  mockUseAccess.mockReturnValue(adminAccess());
});

describe('AdminTabs', () => {
  it('admin sees both', () => {
    render(<AdminTabs />);

    expect(screen.getByRole('tab', { name: 'com_admin_tab_general' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'com_admin_tab_ai' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('head sees only ai tab', () => {
    mockPathname = '/admin/ai/users';
    mockUseAccess.mockReturnValue(headAccess());

    render(<AdminTabs />);

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'com_admin_tab_ai' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selects the AI tab when the route is one of its sections', () => {
    mockPathname = '/admin/spend';
    render(<AdminTabs />);
    expect(screen.getByRole('tab', { name: 'com_admin_tab_ai' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selects the AI tab for the new ai user and department routes', () => {
    mockPathname = '/admin/ai/departments/d1';
    render(<AdminTabs />);
    expect(screen.getByRole('tab', { name: 'com_admin_tab_ai' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('navigates to the first section of the tab on click', () => {
    render(<AdminTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'com_admin_tab_ai' }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/ai/users');
  });

  it('shows a loading skeleton instead of tabs while access is loading', () => {
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, aiCapabilities: new Set(), canEnter: false, isLoading: true }),
    );

    render(<AdminTabs />);

    expect(screen.getAllByTestId('tabs-skeleton-item').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows a skeleton while the ai backend is still answering for an admin', () => {
    mockUseAccess.mockReturnValue(
      adminAccess({ aiCapabilities: new Set(), isAiLoading: true }),
    );

    render(<AdminTabs />);

    expect(screen.getAllByTestId('tabs-skeleton-item').length).toBeGreaterThan(0);
  });

  it('keeps the ai tab for an admin when the ai backend is down', () => {
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set(), aiError: true }));

    render(<AdminTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'com_admin_tab_ai' }));

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(mockNavigate).toHaveBeenCalledWith('/admin/ai/users');
  });

  it('hides the ai tab from an admin the ai backend does not know', () => {
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set() }));

    render(<AdminTabs />);

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'com_admin_tab_general' })).toBeInTheDocument();
  });

  it('navigates to the first visible section of a tab, not its hardcoded default', () => {
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set(['read:usage']) }));

    render(<AdminTabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'com_admin_tab_ai' }));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/spend');
  });

  it('keeps the general tab visible when the directory is unavailable', () => {
    mockUseAccess.mockReturnValue(
      adminAccess({ isAdmin: false, directoryError: true, canEnter: true }),
    );

    render(<AdminTabs />);

    expect(screen.getByRole('tab', { name: 'com_admin_tab_general' })).toBeInTheDocument();
  });

  it('never hands the switcher a tab it does not have and redirects to the first available one', () => {
    mockPathname = '/admin/ai/users';
    mockUseAccess.mockReturnValue(adminAccess({ aiCapabilities: new Set() }));

    render(<AdminTabs />);

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'com_admin_tab_general' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(mockNavigate).toHaveBeenCalledWith('/admin/users', { replace: true });
  });

  it('does not redirect when the routed tab is available', () => {
    render(<AdminTabs />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('moves between tabs with the arrow keys', () => {
    render(<AdminTabs />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(mockNavigate).toHaveBeenLastCalledWith('/admin/ai/users');

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(mockNavigate).toHaveBeenLastCalledWith('/admin/ai/users');

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(mockNavigate).toHaveBeenLastCalledWith('/admin/ai/users');
  });
});
