import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserListItem } from '~/api';
import AiUsersTable from '../AiUsersTable';
import { adminAccess, headAccess } from '../../../__fixtures__/access';

const mockUseAdminUsersQuery = jest.fn();
const mockNavigate = jest.fn();
const mockUseAccess = jest.fn();
const mockUseModelLabel = jest.fn();

jest.mock('~/data-provider/Admin', () => ({
  useAdminUsersQuery: (...args: unknown[]) => mockUseAdminUsersQuery(...args),
}));

jest.mock('~/components/Admin/utils/modelLabels', () => ({
  useModelLabel: (enabled?: boolean) => {
    mockUseModelLabel(enabled);
    return (id: string) => id;
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDebounce: (value: unknown) => value,
  useAccess: () => mockUseAccess(),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('@librechat/client', () => {
  const { createLibrechatClientMock } = jest.requireActual('test/adminClientMock');
  return createLibrechatClientMock(() => undefined);
});

const USER: AdminUserListItem = {
  id: 'user-1',
  employeeId: 'emp-1',
  openidId: null,
  name: 'Ivan Ivanov',
  email: 'ivan@example.com',
  position: 'Lawyer',
  role: 'ADMIN',
  departmentId: null,
  departmentName: null,
  limits: { dailyCostUsd: null },
  limitsOverride: null,
  allowedModels: [],
  allowedModelsOverride: null,
  defaultModel: null,
  defaultModelOverride: null,
  blocked: false,
  canUploadKnowledge: false,
  spendToday: { costUsd: 0, requests: 0 },
  spendMonth: { costUsd: 0, requests: 0 },
};

function renderTable(users: AdminUserListItem[] = [USER], total = users.length) {
  mockUseAdminUsersQuery.mockReturnValue({
    data: { users, total, limit: 50, offset: 0 },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(
    <MemoryRouter>
      <AiUsersTable departments={[{ id: 'dept-1', name: 'Sales' } as never]} />
    </MemoryRouter>,
  );
}

function lastQuery() {
  return mockUseAdminUsersQuery.mock.calls[mockUseAdminUsersQuery.mock.calls.length - 1][0];
}

beforeEach(() => {
  mockUseAdminUsersQuery.mockClear();
  mockNavigate.mockClear();
  mockUseModelLabel.mockClear();
  mockUseAccess.mockReturnValue(adminAccess());
});

describe('AiUsersTable — models catalog access', () => {
  it('head does not request models', () => {
    mockUseAccess.mockReturnValue(headAccess());
    renderTable();
    expect(mockUseModelLabel).toHaveBeenLastCalledWith(false);
  });

  it('admin requests models', () => {
    renderTable();
    expect(mockUseModelLabel).toHaveBeenLastCalledWith(true);
  });
});

describe('AiUsersTable — rows', () => {
  it('renders the user name as a real link pointing at the edit page', () => {
    renderTable();

    expect(screen.getByRole('link', { name: USER.name })).toHaveAttribute(
      'href',
      '/admin/ai/users/emp-1',
    );
  });

  it('navigates to the edit page when clicking anywhere else in the row', () => {
    renderTable();

    fireEvent.click(screen.getByText(USER.email));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/ai/users/emp-1');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('navigates exactly once from the edit pencil, not twice via bubbling', () => {
    renderTable();

    fireEvent.click(screen.getByLabelText('com_admin_users_edit'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows the role localized rather than as the raw stored string', () => {
    renderTable();

    const roleCell = screen
      .getAllByText('com_admin_role_admin')
      .find((node) => node.tagName === 'TD');
    expect(roleCell).toBeInTheDocument();
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
  });

  it('shows position and falls back to a dash when it is empty', () => {
    renderTable([{ ...USER, position: '' }]);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Lawyer')).not.toBeInTheDocument();
  });

  it('links a row without an employee id by the AI user id', () => {
    renderTable([{ ...USER, employeeId: null }]);

    expect(screen.getByRole('link', { name: USER.name })).toHaveAttribute(
      'href',
      '/admin/ai/users/user-1',
    );
  });

  it('shows a dash for a user without a department', () => {
    renderTable([{ ...USER, position: 'Lawyer', departmentName: null }]);

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('com_admin_users_no_department')).not.toBeInTheDocument();
  });

  it('marks a blocked user next to the name', () => {
    renderTable([{ ...USER, blocked: true }]);

    expect(screen.getByText('com_admin_employees_badge_blocked')).toBeInTheDocument();
  });

  it('does not mark an active user as blocked', () => {
    renderTable();

    expect(screen.queryByText('com_admin_employees_badge_blocked')).not.toBeInTheDocument();
  });
});

describe('AiUsersTable — filters', () => {
  it('starts without any filter in the query', () => {
    renderTable();

    expect(lastQuery()).toEqual({ limit: 50, offset: 0 });
  });

  it('sends the typed search term', async () => {
    renderTable();

    fireEvent.change(screen.getByLabelText('com_admin_users_search_placeholder'), {
      target: { value: 'ivan' },
    });

    await waitFor(() => expect(lastQuery().search).toBe('ivan'));
  });

  it('has no status filter', () => {
    renderTable();

    expect(screen.queryByLabelText('com_admin_users_filter_status')).not.toBeInTheDocument();
  });

  it('sends the no-department sentinel as a real value, not as "all"', async () => {
    renderTable();

    fireEvent.change(screen.getByLabelText('com_admin_users_filter_department'), {
      target: { value: 'none' },
    });

    await waitFor(() => expect(lastQuery().departmentId).toBe('none'));
  });

  it('drops a filter reset back to "all" from the query entirely', async () => {
    renderTable();

    const roleSelect = screen.getByLabelText('com_admin_users_filter_role');
    fireEvent.change(roleSelect, { target: { value: 'ADMIN' } });
    await waitFor(() => expect(lastQuery().role).toBe('ADMIN'));

    fireEvent.change(roleSelect, { target: { value: 'all' } });

    await waitFor(() => expect(lastQuery()).toEqual({ limit: 50, offset: 0 }));
  });

  /** Страница 3 старого набора после смены фильтра показала бы пустоту. */
  it('returns to the first page when a filter changes', async () => {
    renderTable([USER], 500);

    fireEvent.click(screen.getByText('com_ui_next'));
    await waitFor(() => expect(lastQuery().offset).toBe(50));

    fireEvent.change(screen.getByLabelText('com_admin_users_filter_role'), {
      target: { value: 'HEAD' },
    });

    await waitFor(() => expect(lastQuery().offset).toBe(0));
  });

  it('explains an empty result differently when filters are active', () => {
    renderTable([], 0);

    expect(screen.getByText('com_admin_ai_users_empty_title')).toBeInTheDocument();
  });
});
