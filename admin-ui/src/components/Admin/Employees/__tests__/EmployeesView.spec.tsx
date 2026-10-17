import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import type { DirectoryEmployee, DirectoryInvite } from '~/types/directory';
import { directoryEmployee } from '~/components/Admin/__fixtures__/employee';
import EmployeesView from '../EmployeesView';

const mockEmployeesQuery = jest.fn();
const mockInvite = jest.fn();
const mockInviteReset = jest.fn();
const mockRevoke = jest.fn();
const mockNavigate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/data-provider/Directory', () => ({
  useDirectoryEmployeesQuery: (params: unknown) => mockEmployeesQuery(params),
  useDirectoryDepartmentsQuery: () => ({
    data: [
      { id: 'dept-1', name: 'Legal' },
      { id: 'dept-2', name: 'Finance' },
    ],
  }),
  useInviteDirectoryEmployeeMutation: () => ({
    mutate: mockInvite,
    reset: mockInviteReset,
    isLoading: false,
  }),
  useRevokeDirectoryInviteMutation: () => ({ mutate: mockRevoke, isLoading: false }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options == null ? key : `${key} ${JSON.stringify(options)}`,
  useDebounce: (value: unknown) => value,
}));

jest.mock('@librechat/client', () => {
  const { createEmployeesClientMock } = jest.requireActual('test/employeesClientMock');
  return createEmployeesClientMock((...args: unknown[]) => mockShowToast(...args));
});

const employee = directoryEmployee;

function mockResult(items: DirectoryEmployee[], total = items.length) {
  mockEmployeesQuery.mockReturnValue({
    data: { items, total },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
}

function renderView() {
  return render(
    <MemoryRouter>
      <EmployeesView />
    </MemoryRouter>,
  );
}

describe('EmployeesView', () => {
  it('renders dashes for empty position and department', () => {
    mockResult([employee({ position: '', department_id: null })]);
    renderView();

    const row = screen.getByText('Ivan Petrov').closest('tr')!;
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('shows name, email, position, department and badges', () => {
    mockResult([employee({ is_admin: true, blocked: true, status: 'blocked' })]);
    renderView();

    const row = screen.getByText('Ivan Petrov').closest('tr')!;
    expect(within(row).getByText('ivan@example.test')).toBeInTheDocument();
    expect(within(row).getByText('CTO')).toBeInTheDocument();
    expect(within(row).getByText('Legal')).toBeInTheDocument();
    expect(within(row).getByText('com_admin_employees_badge_admin')).toBeInTheDocument();
    expect(within(row).getByText('com_admin_employees_status_blocked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ivan Petrov' })).toHaveAttribute(
      'href',
      '/admin/users/emp-1',
    );
  });

  it('has an add employee button linking to the create page', () => {
    mockResult([employee()]);
    renderView();

    expect(screen.getByText('com_admin_employees_create').closest('a')).toHaveAttribute(
      'href',
      '/admin/users/new',
    );
  });

  it('filters by department and status', () => {
    mockResult([employee()]);
    renderView();

    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({ page: 1, page_size: 50 });

    fireEvent.change(screen.getByLabelText('com_admin_employees_filter_department'), {
      target: { value: 'dept-2' },
    });
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({
      department_id: 'dept-2',
      page: 1,
      page_size: 50,
    });

    fireEvent.change(screen.getByLabelText('com_admin_employees_filter_department'), {
      target: { value: 'none' },
    });
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({
      department_id: 'none',
      page: 1,
      page_size: 50,
    });

    fireEvent.change(screen.getByLabelText('com_admin_employees_filter_status'), {
      target: { value: 'blocked' },
    });
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({
      department_id: 'none',
      status: 'blocked',
      page: 1,
      page_size: 50,
    });
  });

  it('searches by text', () => {
    mockResult([employee()]);
    renderView();

    fireEvent.change(screen.getByLabelText('com_admin_employees_search_placeholder'), {
      target: { value: 'iv' },
    });
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({ q: 'iv', page: 1, page_size: 50 });
  });

  it('paginates by 50 and resets to the first page when a filter changes', () => {
    mockResult([employee()], 120);
    renderView();

    fireEvent.click(screen.getByText('com_ui_next'));
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({ page: 2, page_size: 50 });

    fireEvent.click(screen.getByText('com_ui_prev'));
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({ page: 1, page_size: 50 });

    fireEvent.click(screen.getByText('com_ui_next'));
    fireEvent.change(screen.getByLabelText('com_admin_employees_filter_status'), {
      target: { value: 'active' },
    });
    expect(mockEmployeesQuery).toHaveBeenLastCalledWith({
      status: 'active',
      page: 1,
      page_size: 50,
    });
  });

  it('disables next on the last page', () => {
    mockResult([employee()], 50);
    renderView();

    expect(screen.getByText('com_ui_next')).toBeDisabled();
  });

  it('shows the empty state', () => {
    mockResult([]);
    renderView();

    expect(screen.getByText('com_admin_employees_empty_title')).toBeInTheDocument();
  });

  it('shows retry on error', () => {
    const refetch = jest.fn();
    mockEmployeesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderView();

    fireEvent.click(screen.getByText('com_admin_retry'));
    expect(refetch).toHaveBeenCalled();
  });

  describe('invitations', () => {
    function directoryError(status: number, body: Record<string, unknown>): AxiosError {
      const error = new AxiosError('failed');
      error.response = { status, data: body, statusText: '', headers: {}, config: {} as never };
      return error;
    }

    it('shows the new link after resend without leaving the list', () => {
      mockInvite.mockImplementation(
        (_vars, options?: { onSuccess?: (data: DirectoryInvite) => void }) =>
          options?.onSuccess?.({
            employee: employee({ id: 'p1', status: 'invited' }),
            invite_link: 'https://auth.example.test/i/1',
            email_sent: false,
          }),
      );
      mockResult([employee({ id: 'p1', status: 'invited', activated_at: null })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      expect(mockInvite.mock.calls[0][0]).toEqual({ id: 'p1' });
      expect(screen.getByDisplayValue('https://auth.example.test/i/1')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('com_admin_employees_invite_not_sent');
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('drops the link from the mutation when the dialog is closed', () => {
      mockInvite.mockImplementation(
        (_vars, options?: { onSuccess?: (data: DirectoryInvite) => void }) =>
          options?.onSuccess?.({
            employee: employee({ id: 'p1', status: 'invited' }),
            invite_link: 'https://auth.example.test/i/1',
            email_sent: true,
          }),
      );
      mockResult([employee({ id: 'p1', status: 'invited' })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));
      fireEvent.click(screen.getByText('com_admin_action_done'));

      expect(mockInviteReset).toHaveBeenCalledTimes(1);
      expect(screen.queryByDisplayValue('https://auth.example.test/i/1')).not.toBeInTheDocument();
    });

    it('offers resend and revoke to a blocked employee who never logged in', () => {
      mockResult([
        employee({ id: 'b1', first_name: 'Anna', status: 'blocked', blocked: true, activated_at: null }),
        employee({
          id: 'b2',
          first_name: 'Boris',
          status: 'blocked',
          blocked: true,
          activated_at: '2026-09-01T10:00:00Z',
        }),
      ]);
      renderView();

      expect(screen.getAllByText('com_admin_employees_invite_resend')).toHaveLength(1);
      const anna = screen.getByText('Anna Petrov').closest('tr')!;
      expect(within(anna).getByText('com_admin_employees_invite_resend')).toBeInTheDocument();
    });

    it('offers resend and revoke only for employees who have not logged in', () => {
      mockResult([
        employee({ id: 'p1', first_name: 'Anna', status: 'invite_expired' }),
        employee({ id: 'a1', first_name: 'Boris', status: 'active' }),
      ]);
      renderView();

      expect(screen.getAllByText('com_admin_employees_invite_resend')).toHaveLength(1);
      expect(screen.getAllByText('com_admin_employees_invite_revoke')).toHaveLength(1);
      const pending = screen.getByText('Anna Petrov').closest('tr')!;
      expect(
        within(pending).getByText('com_admin_employees_status_invite_expired'),
      ).toBeInTheDocument();
      const active = screen.getByText('Boris Petrov').closest('tr')!;
      expect(within(active).getByText('com_admin_employees_status_active')).toBeInTheDocument();
    });

    it('tells the admin when the employee has already logged in', () => {
      mockInvite.mockImplementation((_vars, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'already_active', message: 'x' })),
      );
      mockResult([employee({ id: 'p1', status: 'invited' })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_resend'));

      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_directory_error_already_active',
        status: 'error',
      });
    });

    it('does not open the card when the row buttons are clicked', () => {
      mockResult([employee({ id: 'p1', status: 'invited' })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_revoke'));

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('revokes after confirmation', () => {
      mockRevoke.mockImplementation((_id, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
      );
      mockResult([employee({ id: 'p1', status: 'invited' })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_revoke'));
      expect(mockRevoke).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('alertdialog')).getByText('com_admin_employees_revoke_action'));

      expect(mockRevoke.mock.calls[0][0]).toBe('p1');
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_toast_invite_revoked',
        status: 'success',
      });
    });

    it('shows the refusal when the employee logged in before the revoke', () => {
      mockRevoke.mockImplementation((_id, options?: { onError?: (error: unknown) => void }) =>
        options?.onError?.(directoryError(409, { error_code: 'already_active', message: 'x' })),
      );
      mockResult([employee({ id: 'p1', status: 'invited' })]);
      renderView();

      fireEvent.click(screen.getByText('com_admin_employees_invite_revoke'));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByText('com_admin_employees_revoke_action'));

      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_admin_directory_error_already_active',
        status: 'error',
      });
    });

    it('falls back for an unknown status', () => {
      mockResult([
        employee({ id: 'x1', first_name: 'Anna', status: 'future' as never, blocked: true }),
        employee({ id: 'x2', first_name: 'Boris', status: 'future' as never, blocked: false }),
      ]);
      renderView();

      const blocked = screen.getByText('Anna Petrov').closest('tr')!;
      const active = screen.getByText('Boris Petrov').closest('tr')!;
      expect(within(blocked).getByText('com_admin_employees_status_blocked')).toBeInTheDocument();
      expect(within(active).getByText('com_admin_employees_status_active')).toBeInTheDocument();
      expect(screen.queryByText('com_admin_employees_invite_resend')).not.toBeInTheDocument();
    });

    it('filters by invited', () => {
      mockResult([employee()]);
      renderView();

      fireEvent.change(screen.getByLabelText('com_admin_employees_filter_status'), {
        target: { value: 'invited' },
      });

      expect(mockEmployeesQuery).toHaveBeenLastCalledWith({
        status: 'invited',
        page: 1,
        page_size: 50,
      });
    });

    it('shows the department head badge', () => {
      mockResult([employee({ is_head: true })]);
      renderView();

      const row = screen.getByText('Ivan Petrov').closest('tr')!;
      expect(within(row).getByText('com_admin_employees_badge_head')).toBeInTheDocument();
    });
  });
});
