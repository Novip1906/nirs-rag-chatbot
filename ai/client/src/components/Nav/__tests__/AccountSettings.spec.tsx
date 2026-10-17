import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import AccountSettings from '../AccountSettings';

const mockUseAuthContext = jest.fn();
const mockUseGetStartupConfig = jest.fn();

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockUseGetStartupConfig(),
  useGetUserBalance: () => ({ data: undefined }),
}));

jest.mock('~/components/Nav/SettingsTabs/General/ArchivedChatsModal', () => ({
  ArchivedChatsModal: () => null,
}));

jest.mock('../Settings', () => ({
  __esModule: true,
  default: () => null,
}));

/**
 * The real Ariakit menu only mounts its content once opened, which would force this
 * test to drive a full open interaction just to assert on item visibility. Stubbed to
 * always render its children so the test can focus on the admin-role gate itself.
 */
jest.mock('@ariakit/react/menu', () => {
  const ReactActual = jest.requireActual('react');
  return {
    MenuProvider: ({ children }: React.PropsWithChildren<unknown>) => children,
    MenuButton: ReactActual.forwardRef(function MockMenuButton(
      {
        children,
        className,
        'aria-label': ariaLabel,
      }: React.PropsWithChildren<{ className?: string; 'aria-label'?: string }>,
      ref: React.Ref<HTMLButtonElement>,
    ) {
      return ReactActual.createElement(
        'button',
        { type: 'button', ref, className, 'aria-label': ariaLabel },
        children,
      );
    }),
    Menu: ({ children }: React.PropsWithChildren<unknown>) =>
      ReactActual.createElement('div', null, children),
    MenuItem: ({
      children,
      onClick,
      className,
      render,
    }: React.PropsWithChildren<{
      onClick?: () => void;
      className?: string;
      render?: React.ReactElement<{ href?: string; target?: string; rel?: string }>;
    }>) =>
      render
        ? ReactActual.cloneElement(render, { role: 'menuitem' })
        : ReactActual.createElement('div', { role: 'menuitem', className, onClick }, children),
  };
});

jest.mock('@librechat/client', () => ({
  GearIcon: () => null,
  DropdownMenuSeparator: () => <hr />,
  Avatar: () => <div data-testid="avatar" />,
}));

function renderWithRole(role: string, adminPanelURL = 'https://admin.example.com') {
  mockUseAuthContext.mockReturnValue({
    user: { id: 'user-1', name: 'Test User', email: 'test@example.com', role },
    isAuthenticated: true,
    logout: jest.fn(),
  });
  mockUseGetStartupConfig.mockReturnValue({ data: { adminPanelURL } });
  render(
    <MemoryRouter>
      <AccountSettings />
    </MemoryRouter>,
  );
}

describe('AccountSettings — admin panel entry', () => {
  it('shows the admin panel item for an admin user and links to adminPanelURL', () => {
    renderWithRole(SystemRoles.ADMIN);

    const item = screen.getByText('com_nav_admin_panel').closest('[role="menuitem"]');
    expect(item).toHaveAttribute('href', 'https://admin.example.com');
    expect(item).toHaveAttribute('target', '_blank');
  });

  it('shows the admin panel item for a HEAD user (excluded from ADMIN_LEVEL_ROLES)', () => {
    renderWithRole(SystemRoles.HEAD);

    expect(screen.getByText('com_nav_admin_panel')).toBeInTheDocument();
  });

  it('hides the admin panel item for a regular user', () => {
    renderWithRole(SystemRoles.USER);

    expect(screen.queryByText('com_nav_admin_panel')).not.toBeInTheDocument();
  });

  it('hides the admin panel item when adminPanelURL is empty', () => {
    renderWithRole(SystemRoles.ADMIN, '');

    expect(screen.queryByText('com_nav_admin_panel')).not.toBeInTheDocument();
  });
});

describe('AccountSettings — profile menu', () => {
  it('не показывает помощь и горячие клавиши', () => {
    renderWithRole(SystemRoles.USER);

    expect(screen.queryByText('com_nav_help')).not.toBeInTheDocument();
    expect(screen.queryByText('com_shortcut_keyboard_shortcuts')).not.toBeInTheDocument();
    expect(screen.getByText('com_nav_archived_chats')).toBeInTheDocument();
  });
});
