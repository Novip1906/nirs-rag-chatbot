import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserListItem } from '~/api';
import AiUsersView from '../AiUsersView';

const mockUseAdminDepartmentsQuery = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminDepartmentsQuery: (config: unknown) => mockUseAdminDepartmentsQuery(config),
  useAdminUsersQuery: () => ({
    data: { users: [USER], total: 1, limit: 50, offset: 0 },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('~/components/Admin/utils/modelLabels', () => ({
  useModelLabel: () => (id: string) => id,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDebounce: (value: unknown) => value,
  useAccess: () => ({ isAdmin: true, aiCapabilities: new Set(['manage:users']) }),
}));

jest.mock('@librechat/client', () => {
  const { createLibrechatClientMock } = jest.requireActual('test/adminClientMock');
  return createLibrechatClientMock(() => undefined);
});

const USER: AdminUserListItem = {
  id: 'mongo-1',
  employeeId: 'emp-1',
  openidId: 'sub-1',
  name: 'Ivan Ivanov',
  email: 'ivan@example.com',
  position: 'Lawyer',
  role: 'USER',
  departmentId: 'dept-1',
  departmentName: 'Legal',
  limits: { dailyCostUsd: 5 },
  limitsOverride: null,
  allowedModels: [],
  allowedModelsOverride: null,
  defaultModel: 'gpt-4o',
  defaultModelOverride: null,
  blocked: false,
  canUploadKnowledge: false,
  spendToday: { costUsd: 1, requests: 2 },
  spendMonth: { costUsd: 3, requests: 4 },
};

function renderView() {
  mockUseAdminDepartmentsQuery.mockReturnValue({ data: [] });
  render(
    <MemoryRouter initialEntries={['/admin/ai/users']}>
      <AiUsersView />
    </MemoryRouter>,
  );
}

describe('AiUsersView', () => {
  it('has no invites tab and no add button', () => {
    renderView();

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('com_admin_users_add')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('rows link by employeeId', () => {
    renderView();

    expect(screen.getByRole('link', { name: 'Ivan Ivanov' })).toHaveAttribute(
      'href',
      '/admin/ai/users/emp-1',
    );
  });

  it('shows position, department, role, limit and model columns', () => {
    renderView();

    const table = within(screen.getByRole('table'));
    expect(table.getByText('Lawyer')).toBeInTheDocument();
    expect(table.getByText('Legal')).toBeInTheDocument();
    expect(table.getByText('com_admin_role_user')).toBeInTheDocument();
    expect(table.getByText('com_admin_ai_users_limit_of')).toBeInTheDocument();
    expect(table.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('asks for departments only when the viewer is an admin', () => {
    renderView();

    expect(mockUseAdminDepartmentsQuery).toHaveBeenCalledWith({ enabled: true });
  });
});
